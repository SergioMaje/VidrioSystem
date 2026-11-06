-- Anulación de ventas, paso 2 de 2.
--
-- El 05/11/2026 un empleado convirtió dos veces la misma cotización en venta. La
-- caja quedó con un ingreso que nunca entró al cajón, y no había forma correcta de
-- corregirlo: `ventas` no tenía estado, y la única salida era la política
-- admin_delete_ventas, un DELETE físico que borra la evidencia.
--
-- Recordatorio del modelo: `ventas` es el libro de pagos (20260821053000). Cada
-- fila es un cobro, y una cotización tiene N filas (anticipo y abonos). Lo que se
-- anula es un cobro.
--
-- Principio: un cobro nunca se borra. Se anula con la misma convención que
-- caja_movimientos y financiera_desembolsos (anulado_at / anulado_por /
-- motivo_anulacion) y se registran los movimientos inversos:
--   * caja: egreso `reverso_anulacion` por el mismo valor y método;
--   * inventario: `reintegro_anulacion` de lo que la venta de mostrador descontó.
-- Las ventas por cotización no descuentan inventario: eso pasa al cerrar
-- producción. Por eso, si la orden ya avanzó, la anulación se bloquea.
--
-- Y para que no se repita:
--   * registrar_anticipo_cotizacion rechaza convertir una cotización que ya
--     tiene cobros activos, y acepta una clave de idempotencia;
--   * un índice único parcial impide dos cobros de conversión activos por
--     cotización.
-- Antes de aplicar en prod, correr supabase/snippets/detectar_ventas_duplicadas.sql:
-- si ya hay duplicados, el índice hace fallar esta migración.

-- ── 1. Columnas ─────────────────────────────────────────────────────────────

alter table public.ventas
  add column if not exists anulado_at timestamptz,
  add column if not exists anulado_por uuid,
  add column if not exists motivo_anulacion text,
  -- La genera el navegador una vez por diálogo de cobro: un reintento o un doble
  -- clic con la misma clave no cobra dos veces.
  add column if not exists idempotency_key uuid;

alter table public.ventas drop constraint if exists ventas_anulado_por_fkey;
alter table public.ventas add constraint ventas_anulado_por_fkey
  foreign key (empresa_id, anulado_por) references public.usuarios(empresa_id, id);

-- La anulación va completa o no va. El mínimo de 10 caracteres también se exige
-- aquí, no solo en el RPC.
alter table public.ventas drop constraint if exists ventas_anulacion_completa;
alter table public.ventas add constraint ventas_anulacion_completa check (
  (anulado_at is null and anulado_por is null and motivo_anulacion is null)
  or (anulado_at is not null and anulado_por is not null
      and length(btrim(coalesce(motivo_anulacion, ''))) >= 10)
);

create unique index if not exists ventas_idempotency_key_key
  on public.ventas (empresa_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_ventas_anuladas
  on public.ventas (empresa_id, anulado_at)
  where anulado_at is not null;

alter table public.ventas_mostrador
  add column if not exists anulado_at timestamptz,
  add column if not exists anulado_por uuid,
  add column if not exists motivo_anulacion text;

alter table public.ventas_mostrador drop constraint if exists ventas_mostrador_anulado_por_fkey;
alter table public.ventas_mostrador add constraint ventas_mostrador_anulado_por_fkey
  foreign key (empresa_id, anulado_por) references public.usuarios(empresa_id, id);

alter table public.ventas_mostrador drop constraint if exists ventas_mostrador_anulacion_completa;
alter table public.ventas_mostrador add constraint ventas_mostrador_anulacion_completa check (
  (anulado_at is null and anulado_por is null and motivo_anulacion is null)
  or (anulado_at is not null and anulado_por is not null
      and length(btrim(coalesce(motivo_anulacion, ''))) >= 10)
);

-- El reverso es un movimiento de caja más, ligado al cobro que compensa.
-- `afecta_efectivo` es falso solo cuando la caja original ya cerró y el admin
-- indicó que hoy no sale efectivo del cajón. Es el caso del duplicado
-- "fantasma": el faltante ya quedó en el arqueo de ese día, y restarlo otra vez
-- hoy produciría un sobrante falso.
alter table public.caja_movimientos
  add column if not exists venta_id uuid,
  add column if not exists afecta_efectivo boolean not null default true;

alter table public.caja_movimientos drop constraint if exists caja_movimientos_venta_id_fkey;
alter table public.caja_movimientos add constraint caja_movimientos_venta_id_fkey
  foreign key (empresa_id, venta_id) references public.ventas(empresa_id, id);

alter table public.caja_movimientos drop constraint if exists caja_movimientos_reverso_con_venta;
alter table public.caja_movimientos add constraint caja_movimientos_reverso_con_venta
  check ((categoria = 'reverso_anulacion'::public.categoria_gasto) = (venta_id is not null));

alter table public.caja_movimientos drop constraint if exists caja_movimientos_solo_reverso_sin_efectivo;
alter table public.caja_movimientos add constraint caja_movimientos_solo_reverso_sin_efectivo
  check (afecta_efectivo or categoria = 'reverso_anulacion'::public.categoria_gasto);

-- Un cobro se reversa una sola vez.
create unique index if not exists caja_movimientos_un_reverso_por_venta
  on public.caja_movimientos (venta_id)
  where venta_id is not null;

-- Para devolver la cotización a donde estaba si se anula su único cobro. Se
-- llena al convertir; las ventas anteriores a esta migración no lo tienen y
-- vuelven a 'aprobada'.
alter table public.cotizaciones
  add column if not exists estado_previo_venta public.estado_cotizacion;

-- ── 2. Un cobro no se borra ni se reescribe ─────────────────────────────────

drop policy if exists "admin_delete_ventas" on public.ventas;
revoke delete on public.ventas from authenticated, anon;

-- No hay política de UPDATE, así que desde el navegador ya no se podía editar.
-- Este trigger cubre también a los RPC SECURITY DEFINER. Lo único que cambia en
-- un cobro vivo es:
--   * desembolso_id, que manejan los RPC de financieras;
--   * las columnas de anulación, que pasan una sola vez de null a valor.
create or replace function public.ventas_inmutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  c_mutables constant text[] := array['desembolso_id', 'anulado_at', 'anulado_por', 'motivo_anulacion'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un cobro no se puede borrar: anúlalo';
  end if;

  if old.anulado_at is not null then
    raise exception 'Este cobro está anulado y no se puede modificar';
  end if;

  if (to_jsonb(new) - c_mutables) is distinct from (to_jsonb(old) - c_mutables) then
    raise exception 'Los datos de un cobro no se pueden modificar';
  end if;

  return new;
end;
$$;

drop trigger if exists ventas_inmutable on public.ventas;
create trigger ventas_inmutable
  before update or delete on public.ventas
  for each row execute function public.ventas_inmutable();

-- ── 3. Ninguna vía inserta un cobro ya anulado ──────────────────────────────
-- Parte de la versión de 20261016120000_multi_tenant_rls.sql. Lo nuevo:
--   * Las columnas de anulación nunca llegan desde un insert, igual que
--     desembolso_id. Si no, el insert directo de useRegistrarAbono permitiría
--     crear cobros "anulados" que no suman.
--   * El abonado solo cuenta los cobros activos.
create or replace function public.validar_pago_cotizacion()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_total numeric;
  v_abonado numeric;
  v_financiera public.financieras;
begin
  if (select status from public.cash_register_sessions where id = new.session_id and empresa_id = new.empresa_id) is distinct from 'open' then
    raise exception 'La sesión de caja está cerrada';
  end if;

  new.desembolso_id := null;
  new.anulado_at := null;
  new.anulado_por := null;
  new.motivo_anulacion := null;

  if new.metodo_pago = 'financiera' then
    select * into v_financiera from public.financieras where id = new.financiera_id and empresa_id = new.empresa_id;
    if not found then
      raise exception 'Selecciona la financiera que otorgó el crédito';
    end if;
    if not v_financiera.activa then
      raise exception 'La financiera % está desactivada', v_financiera.nombre;
    end if;
    new.referencia_financiera := nullif(btrim(coalesce(new.referencia_financiera, '')), '');
    -- Pesos enteros, igual que comisionEstimada() en src/lib/pagos.ts.
    new.comision_estimada := round(new.monto * v_financiera.comision_pct / 100);
  else
    new.financiera_id := null;
    new.referencia_financiera := null;
    new.comision_estimada := null;
  end if;

  -- Venta de mostrador: se cobra completa en el acto, no hay saldo que validar.
  if new.cotizacion_id is null then
    return new;
  end if;

  select total into v_total from public.cotizaciones where id = new.cotizacion_id and empresa_id = new.empresa_id for update;
  if v_total is null then
    raise exception 'Cotización no encontrada';
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas
   where cotizacion_id = new.cotizacion_id and anulado_at is null;

  if new.metodo_pago = 'financiera' then
    if v_abonado > 0 then
      raise exception 'El crédito con financiera cubre el total de la venta: esta cotización ya tiene pagos registrados';
    end if;
    if new.monto < v_total - 1 then
      raise exception 'El crédito con financiera debe cubrir el total de la cotización (%)', v_total;
    end if;
  end if;

  -- Tolerancia de $1 por el redondeo del IVA.
  if v_abonado + new.monto > v_total + 1 then
    raise exception 'El pago excede el saldo pendiente (saldo: %)', v_total - v_abonado;
  end if;

  if v_abonado = 0 and not public.cumple_anticipo_minimo(new.monto, v_total) then
    if new.autorizado_por is null then
      raise exception 'El anticipo debe ser al menos el 50%% del total (mínimo: %)',
        public.anticipo_minimo(v_total);
    end if;
    if (select rol from public.usuarios where id = new.autorizado_por and empresa_id = new.empresa_id) is distinct from 'admin'::rol_usuario then
      raise exception 'Solo un administrador puede autorizar un anticipo menor al 50%%';
    end if;
  end if;

  return new;
end $function$;

-- ── 4. Una sola conversión activa por cotización ────────────────────────────
-- El índice que pedía la tarea, `unique (cotizacion_id) where no anulada`,
-- rompería los abonos: una cotización tiene varios cobros. Lo que debe ser único
-- es el cobro que la convierte en venta (anticipo, o contado con financiera).
--
-- Ojo: un doble clic no produce dos 'anticipo'. El segundo cobro ve el primero
-- ya abonado y entra como 'abono' o 'saldo_final'. Este índice es el respaldo a
-- nivel de base; la protección real es la validación dentro del RPC, más abajo.
create unique index if not exists ventas_una_conversion_por_cotizacion
  on public.ventas (empresa_id, cotizacion_id)
  where cotizacion_id is not null
    and tipo in ('anticipo'::public.tipo_pago, 'contado'::public.tipo_pago)
    and anulado_at is null;

-- Cambia la firma (parámetro nuevo), así que se elimina la anterior: dos
-- versiones sobrecargadas confundirían a PostgREST.
drop function if exists public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text
);

create or replace function public.registrar_anticipo_cotizacion(
  p_cotizacion_id         uuid,
  p_metodo_pago           public.metodo_pago_venta,
  p_monto                 numeric,
  p_fecha_entrega         date default null,
  p_autorizado_por        uuid default null,
  p_motivo_autorizacion   text default null,
  p_financiera_id         uuid default null,
  p_referencia_financiera text default null,
  p_idempotency_key       uuid default null
) returns public.ordenes_trabajo
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_session uuid;
  v_cot     public.cotizaciones;
  v_previa  public.ventas;
  v_abonado numeric;
  v_orden   public.ordenes_trabajo;
  v_tipo    public.tipo_pago;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un anticipo';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El anticipo debe ser mayor a cero';
  end if;

  -- El `for update` serializa contra otro cobro simultaneo sobre la misma
  -- cotizacion. Va antes de mirar la clave y los cobros existentes: el segundo
  -- clic espera aquí y, al seguir, ya ve el cobro del primero.
  select * into v_cot from public.cotizaciones
   where id = p_cotizacion_id and empresa_id = v_empresa
   for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;

  -- Reintento de la misma petición: el cobro ya entró, se devuelve su orden
  -- sin cobrar otra vez.
  if p_idempotency_key is not null then
    select * into v_previa from public.ventas
     where empresa_id = v_empresa and idempotency_key = p_idempotency_key;
    if found then
      if v_previa.cotizacion_id is distinct from p_cotizacion_id then
        raise exception 'La clave de idempotencia ya se usó en otro cobro';
      end if;
      select * into v_orden from public.ordenes_trabajo
       where cotizacion_id = p_cotizacion_id and empresa_id = v_empresa
       order by (estado = 'cancelada'), created_at desc
       limit 1;
      return v_orden;
    end if;
  end if;

  select coalesce(sum(monto), 0) into v_abonado
    from public.ventas
   where cotizacion_id = p_cotizacion_id and anulado_at is null;

  -- Esto evita el duplicado del 05/11/2026: convertir es el primer cobro, y los
  -- siguientes son abonos.
  if v_abonado > 0 then
    raise exception 'La cotización % ya fue convertida en venta (tiene cobros por %). Para cobrar el saldo usa "Registrar abono".',
      v_cot.numero, v_abonado;
  end if;

  select id into v_session from public.cash_register_sessions
   where status = 'open' and empresa_id = v_empresa;
  if v_session is null then
    raise exception 'Debes abrir caja antes de registrar el anticipo';
  end if;

  -- El crédito liquida la venta de una vez: no es un anticipo.
  v_tipo := case
    when p_metodo_pago = 'financiera' then 'contado'::public.tipo_pago
    else public.tipo_de_pago(v_abonado, p_monto, v_cot.total)
  end;

  -- El insert dispara validar_pago_cotizacion, que comprueba saldo, caja
  -- abierta, anticipo minimo y las reglas de financiera. Aqui no se replica.
  insert into public.ventas
    (cotizacion_id, session_id, metodo_pago, monto, tipo, autorizado_por,
     motivo_autorizacion, usuario_id, financiera_id, referencia_financiera,
     idempotency_key)
  values
    (p_cotizacion_id, v_session, p_metodo_pago, p_monto, v_tipo,
     p_autorizado_por,
     nullif(btrim(coalesce(p_motivo_autorizacion, '')), ''),
     v_usuario, p_financiera_id, p_referencia_financiera,
     p_idempotency_key);

  -- Se guarda de dónde venía la cotización para poder devolverla ahí si se
  -- anula este cobro. Si ya estaba 'vendida' (una venta anulada antes que no
  -- se devolvió), se conserva el previo que hubiera.
  update public.cotizaciones
     set estado_previo_venta = case
           when estado = 'vendida' then estado_previo_venta
           else estado
         end,
         estado = 'vendida',
         fecha_aprobacion = coalesce(fecha_aprobacion, now())
   where id = p_cotizacion_id;

  -- La orden viva de la cotización. Si solo hay una cancelada (su venta se
  -- anuló antes), se reactiva en lugar de crear otra.
  select * into v_orden from public.ordenes_trabajo
   where cotizacion_id = p_cotizacion_id and empresa_id = v_empresa
   order by (estado = 'cancelada'), created_at desc
   limit 1
   for update;

  if found then
    update public.ordenes_trabajo
       set estado = case when estado = 'cancelada' then 'pendiente'::public.estado_orden else estado end,
           fecha_entrega_estimada = coalesce(p_fecha_entrega, fecha_entrega_estimada)
     where id = v_orden.id
    returning * into v_orden;
    return v_orden;
  end if;

  insert into public.ordenes_trabajo
    (numero, cotizacion_id, cliente_id, estado, fecha_entrega_estimada, notas)
  values
    ('OT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text,
     p_cotizacion_id, v_cot.cliente_id, 'pendiente', p_fecha_entrega, v_cot.notas)
  returning * into v_orden;

  return v_orden;
end;
$function$;

revoke execute on function public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text, uuid
) from public, anon;
grant execute on function public.registrar_anticipo_cotizacion(
  uuid, public.metodo_pago_venta, numeric, date, uuid, text, uuid, text, uuid
) to authenticated;

-- ── 5. Lo anulado no cuenta como pagado ni como por cobrar ──────────────────

create or replace view public.cotizaciones_saldo
with (security_invoker = on) as
select
  c.id                                as cotizacion_id,
  c.total                             as total,
  coalesce(sum(v.monto), 0)           as total_abonado,
  c.total - coalesce(sum(v.monto), 0) as saldo,
  case when c.total > 0
       then round(coalesce(sum(v.monto), 0) / c.total * 100, 2)
       else 0 end                     as pct_abonado
from public.cotizaciones c
left join public.ventas v on v.cotizacion_id = c.id and v.anulado_at is null
group by c.id, c.total;

-- Una venta con financiera anulada antes del desembolso sale de la cartera: el
-- desembolso pendiente queda cancelado.
create or replace view public.financieras_por_cobrar
with (security_invoker = on) as
  select
    v.id as venta_id,
    v.financiera_id,
    f.nombre as financiera,
    v.monto,
    coalesce(v.comision_estimada, 0) as comision_estimada,
    v.referencia_financiera,
    v.created_at,
    v.cotizacion_id,
    v.venta_mostrador_id,
    coalesce(c.numero, vm.numero) as documento,
    nullif(trim(coalesce(cc.nombre || ' ' || cc.apellido, mc.nombre || ' ' || mc.apellido, '')), '') as cliente,
    f.dias_desembolso,
    ((now() at time zone 'America/Bogota')::date
      - (v.created_at at time zone 'America/Bogota')::date) as dias,
    ((now() at time zone 'America/Bogota')::date
      - (v.created_at at time zone 'America/Bogota')::date) > f.dias_desembolso as vencida
  from public.ventas v
  join public.financieras f on f.id = v.financiera_id
  left join public.cotizaciones c on c.id = v.cotizacion_id
  left join public.clientes cc on cc.id = c.cliente_id
  left join public.ventas_mostrador vm on vm.id = v.venta_mostrador_id
  left join public.clientes mc on mc.id = vm.cliente_id
  where v.metodo_pago = 'financiera'
    and v.desembolso_id is null
    and v.anulado_at is null;

-- Mismo cuerpo que en 20261016120000. Lo único nuevo es que una venta anulada
-- cuenta como inválida para conciliar.
create or replace function public.registrar_desembolso_financiera(p_financiera_id uuid, p_fecha date, p_monto_recibido numeric, p_venta_ids uuid[], p_cuenta_id uuid default null::uuid, p_referencia text default null::text, p_notas text default null::text)
 returns financiera_desembolsos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_ids uuid[];
  v_encontradas integer;
  v_invalidas integer;
  v_total numeric(12,2);
  v_comision numeric(12,2);
  v_desembolso public.financiera_desembolsos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un desembolso';
  end if;

  if not exists (select 1 from public.financieras where id = p_financiera_id and empresa_id = public.current_empresa_id()) then
    raise exception 'La financiera no existe';
  end if;

  if p_fecha is null then
    raise exception 'Indica la fecha en que llegó el desembolso';
  end if;

  if p_monto_recibido is null or p_monto_recibido <= 0 then
    raise exception 'El monto recibido debe ser mayor a cero';
  end if;

  select array_agg(distinct id) into v_ids from unnest(p_venta_ids) as id where id is not null;
  if v_ids is null then
    raise exception 'Selecciona las ventas que cubre este desembolso';
  end if;

  -- El lock serializa contra otra conciliación simultánea de las mismas ventas
  -- y contra una anulación simultánea.
  perform 1 from public.ventas where id = any(v_ids) and empresa_id = public.current_empresa_id() for update;

  select count(*),
         count(*) filter (where metodo_pago <> 'financiera'
                             or financiera_id is distinct from p_financiera_id
                             or desembolso_id is not null
                             or anulado_at is not null),
         coalesce(sum(monto), 0),
         coalesce(sum(comision_estimada), 0)
    into v_encontradas, v_invalidas, v_total, v_comision
    from public.ventas
   where id = any(v_ids) and empresa_id = public.current_empresa_id();

  if v_encontradas <> cardinality(v_ids) then
    raise exception 'Alguna de las ventas seleccionadas ya no existe';
  end if;

  if v_invalidas > 0 then
    raise exception 'Hay ventas que no son de esta financiera, que ya tienen desembolso o que fueron anuladas';
  end if;

  if p_monto_recibido > v_total then
    raise exception 'El monto recibido (%) supera el total de las ventas seleccionadas (%)',
      p_monto_recibido, v_total;
  end if;

  insert into public.financiera_desembolsos
    (financiera_id, fecha, monto_recibido, total_ventas, comision_estimada, num_ventas,
     cuenta_pago_empresa_id, referencia, notas, usuario_id)
  values
    (p_financiera_id, p_fecha, p_monto_recibido, v_total, v_comision, cardinality(v_ids),
     p_cuenta_id,
     nullif(btrim(coalesce(p_referencia, '')), ''),
     nullif(btrim(coalesce(p_notas, '')), ''),
     v_usuario)
  returning * into v_desembolso;

  update public.ventas set desembolso_id = v_desembolso.id where id = any(v_ids);

  return v_desembolso;
end;
$function$;

-- ── 6. Caja: el cuadre descuenta los reversos ───────────────────────────────
-- El esperado sigue siendo apertura + ingresos en efectivo − egresos en
-- efectivo. Los reversos son egresos (caja_movimientos), así que entran solos.
-- El único cambio es respetar `afecta_efectivo`.
--
-- Los ingresos siguen incluyendo el cobro anulado: el reverso lo compensa, y la
-- caja conserva el rastro de que entró y salió. Los reportes de ventas son los
-- que excluyen lo anulado.

create or replace function public.cerrar_caja(p_session_id uuid, p_counted_amount numeric)
 returns cash_register_sessions
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sesion public.cash_register_sessions;
  v_efectivo numeric;
  v_egresos numeric;
  v_esperado numeric;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para cerrar la caja';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'El conteo físico no puede ser negativo';
  end if;

  select * into v_sesion
  from public.cash_register_sessions
  where id = p_session_id and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'La sesión de caja no existe';
  end if;

  if v_sesion.status <> 'open'::public.estado_caja then
    raise exception 'Esta caja ya fue cerrada';
  end if;

  select coalesce(sum(monto), 0) into v_efectivo
  from public.ventas
  where session_id = p_session_id and metodo_pago = 'efectivo';

  -- Gastos y reversos de anulación. Los gastos anulados no salieron del cajón,
  -- y un reverso sin salida de efectivo tampoco.
  select coalesce(sum(monto), 0) into v_egresos
  from public.caja_movimientos
  where session_id = p_session_id
    and metodo_pago = 'efectivo'
    and anulado_at is null
    and afecta_efectivo;

  v_esperado := v_sesion.opening_amount + v_efectivo - v_egresos;

  update public.cash_register_sessions
  set closed_at = now(),
      closed_by = auth.uid(),
      expected_amount = v_esperado,
      counted_amount = p_counted_amount,
      difference = p_counted_amount - v_esperado,
      status = 'closed'::public.estado_caja
  where id = p_session_id
  returning * into v_sesion;

  return v_sesion;
end;
$function$;

-- Mismo cuerpo que en 20261016120000. El disponible descuenta también los
-- reversos que sacaron efectivo, y un gasto manual no puede usar la categoría
-- de reverso.
create or replace function public.registrar_gasto_caja(p_categoria categoria_gasto, p_concepto text, p_monto numeric, p_metodo_pago metodo_pago_venta)
 returns caja_movimientos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_sesion public.cash_register_sessions;
  v_ventas numeric;
  v_gastos numeric;
  v_disponible numeric;
  v_movimiento public.caja_movimientos;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para registrar un gasto';
  end if;

  if p_categoria = 'reverso_anulacion'::public.categoria_gasto then
    raise exception 'Los reversos de anulación solo los genera la anulación de una venta';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'El monto del gasto debe ser mayor a cero';
  end if;

  if p_concepto is null or length(trim(p_concepto)) = 0 then
    raise exception 'Describe el gasto';
  end if;

  -- El lock serializa contra otro gasto simultáneo: sin él, dos retiros podrían
  -- validar cada uno contra el mismo disponible y vaciar el cajón de más.
  select * into v_sesion
  from public.cash_register_sessions
  where status = 'open'::public.estado_caja and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'Debes abrir caja antes de registrar un gasto';
  end if;

  -- Del cajón no puede salir plata que no está. Sin esta validación el efectivo
  -- esperado del cierre podría quedar negativo.
  if p_metodo_pago = 'efectivo'::public.metodo_pago_venta then
    v_disponible := public.efectivo_disponible_caja(v_sesion.id);

    if p_monto > v_disponible then
      raise exception 'No hay tanto efectivo en caja: disponible %', v_disponible;
    end if;
  end if;

  insert into public.caja_movimientos (session_id, categoria, concepto, monto, metodo_pago, usuario_id)
  values (v_sesion.id, p_categoria, trim(p_concepto), p_monto, p_metodo_pago, v_usuario)
  returning * into v_movimiento;

  return v_movimiento;
end;
$function$;

-- El efectivo que debería haber en el cajón de un turno. Es la misma cifra que
-- calcula cerrar_caja, en un solo lugar para el gasto y la anulación.
create or replace function public.efectivo_disponible_caja(p_session_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.opening_amount
       + coalesce((select sum(v.monto) from public.ventas v
                    where v.session_id = s.id and v.metodo_pago = 'efectivo'), 0)
       - coalesce((select sum(m.monto) from public.caja_movimientos m
                    where m.session_id = s.id and m.metodo_pago = 'efectivo'
                      and m.anulado_at is null and m.afecta_efectivo), 0)
  from public.cash_register_sessions s
  where s.id = p_session_id;
$$;

revoke execute on function public.efectivo_disponible_caja(uuid) from public, anon, authenticated;

-- Mismo cuerpo que en 20261016120000. Un reverso no se anula: deshacerlo
-- dejaría la venta anulada sin su contrapartida en caja.
create or replace function public.anular_movimiento_caja(p_movimiento_id uuid, p_motivo text)
 returns caja_movimientos
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_movimiento public.caja_movimientos;
  v_estado public.estado_caja;
begin
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular un movimiento';
  end if;

  -- `is distinct from` y no `<>`: si el usuario no tiene fila en `usuarios`,
  -- get_user_rol() devuelve null y la comparación normal daría null, que en un
  -- `if` es falso — es decir, dejaría anular a quien no es nadie.
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular un movimiento';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Indica el motivo de la anulación';
  end if;

  select * into v_movimiento
  from public.caja_movimientos
  where id = p_movimiento_id and empresa_id = public.current_empresa_id()
  for update;

  if not found then
    raise exception 'El movimiento no existe';
  end if;

  if v_movimiento.categoria = 'reverso_anulacion'::public.categoria_gasto then
    raise exception 'Un reverso de anulación no se puede anular';
  end if;

  if v_movimiento.anulado_at is not null then
    raise exception 'Este movimiento ya fue anulado';
  end if;

  select status into v_estado
  from public.cash_register_sessions
  where id = v_movimiento.session_id;

  if v_estado <> 'open'::public.estado_caja then
    raise exception 'No se puede anular un movimiento de un turno ya cerrado';
  end if;

  update public.caja_movimientos
  set anulado_at = now(),
      anulado_por = v_usuario,
      motivo_anulacion = trim(p_motivo)
  where id = p_movimiento_id
  returning * into v_movimiento;

  return v_movimiento;
end;
$function$;

-- El resumen separa los reversos de los gastos. El neto usa la misma regla que
-- cerrar_caja. Las columnas nuevas van al final; las existentes no cambian de
-- significado, salvo que total_gastos y num_gastos ya no incluyen reversos.
drop view if exists public.caja_sesiones_resumen;
create view public.caja_sesiones_resumen
with (security_invoker = on) as
  select
    s.id as session_id,
    coalesce(v.total_efectivo, 0) as total_efectivo,
    coalesce(v.total_transferencia, 0) as total_transferencia,
    coalesce(v.total_tarjeta, 0) as total_tarjeta,
    coalesce(v.total_financiera, 0) as total_financiera,
    coalesce(v.total_cobrado, 0) as total_cobrado,
    coalesce(v.num_pagos, 0) as num_pagos,
    coalesce(g.total_gastos_efectivo, 0) as total_gastos_efectivo,
    coalesce(g.total_gastos, 0) as total_gastos,
    coalesce(g.num_gastos, 0) as num_gastos,
    s.opening_amount + coalesce(v.total_efectivo, 0) - coalesce(g.total_egresos_efectivo, 0) as neto_efectivo,
    coalesce(g.total_reversos_efectivo, 0) as total_reversos_efectivo,
    coalesce(g.total_reversos, 0) as total_reversos,
    coalesce(g.num_reversos, 0) as num_reversos,
    coalesce(v.total_anulado, 0) as total_anulado,
    coalesce(v.num_anulados, 0) as num_anulados
  from public.cash_register_sessions s
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo') as total_efectivo,
      sum(monto) filter (where metodo_pago = 'transferencia') as total_transferencia,
      sum(monto) filter (where metodo_pago = 'tarjeta') as total_tarjeta,
      sum(monto) filter (where metodo_pago = 'financiera') as total_financiera,
      sum(monto) as total_cobrado,
      count(*) as num_pagos,
      sum(monto) filter (where anulado_at is not null) as total_anulado,
      count(*) filter (where anulado_at is not null) as num_anulados
    from public.ventas
    group by session_id
  ) v on v.session_id = s.id
  left join (
    select
      session_id,
      sum(monto) filter (where metodo_pago = 'efectivo' and categoria <> 'reverso_anulacion') as total_gastos_efectivo,
      sum(monto) filter (where categoria <> 'reverso_anulacion') as total_gastos,
      count(*) filter (where categoria <> 'reverso_anulacion') as num_gastos,
      sum(monto) filter (where metodo_pago = 'efectivo' and categoria = 'reverso_anulacion' and afecta_efectivo) as total_reversos_efectivo,
      sum(monto) filter (where categoria = 'reverso_anulacion') as total_reversos,
      count(*) filter (where categoria = 'reverso_anulacion') as num_reversos,
      sum(monto) filter (where metodo_pago = 'efectivo' and afecta_efectivo) as total_egresos_efectivo
    from public.caja_movimientos
    where anulado_at is null
    group by session_id
  ) g on g.session_id = s.id;

grant select on public.caja_sesiones_resumen to authenticated;

-- ── 7. Anular una venta ─────────────────────────────────────────────────────
-- Todo en una transacción: si algún paso falla, no queda nada a medias.
create or replace function public.anular_venta(
  p_venta_id      uuid,
  p_motivo        text,
  -- Solo cuenta si la caja del cobro ya cerró y el pago fue en efectivo: ¿sale
  -- hoy plata del cajón (devolución) o el dinero nunca entró?
  p_sale_efectivo boolean default true
) returns public.ventas
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_usuario   uuid := auth.uid();
  v_empresa   uuid := public.current_empresa_id();
  v_motivo    text := btrim(coalesce(p_motivo, ''));
  v_venta     public.ventas;
  v_cot       public.cotizaciones;
  v_vm        public.ventas_mostrador;
  v_documento text;
  v_original  public.cash_register_sessions;
  v_sesion    public.cash_register_sessions;
  v_afecta    boolean := true;
  v_otros     integer;
  v_orden     public.ordenes_trabajo;
  v_mov       public.movimientos_inventario;
  v_item      public.items_inventario;
  v_financiera text;
begin
  -- ── Permisos y datos ──
  if v_usuario is null then
    raise exception 'Debes iniciar sesión para anular una venta';
  end if;

  -- `is distinct from`: un usuario sin fila en `usuarios` tiene rol null y no
  -- debe pasar como admin (mismo criterio que anular_movimiento_caja).
  if public.get_user_rol() is distinct from 'admin'::public.rol_usuario then
    raise exception 'Solo un administrador puede anular una venta';
  end if;

  if length(v_motivo) < 10 then
    raise exception 'Escribe el motivo de la anulación (mínimo 10 caracteres)';
  end if;

  -- ── Bloqueos ──
  -- Primero el documento y después el cobro: es el mismo orden en que toman
  -- los locks registrar_anticipo_cotizacion y validar_pago_cotizacion. Así una
  -- anulación y un cobro simultáneos no se cruzan en un deadlock.
  select * into v_venta from public.ventas
   where id = p_venta_id and empresa_id = v_empresa;
  if not found then
    raise exception 'La venta no existe';
  end if;

  if v_venta.cotizacion_id is not null then
    select * into v_cot from public.cotizaciones
     where id = v_venta.cotizacion_id for update;
    v_documento := v_cot.numero;
  else
    select * into v_vm from public.ventas_mostrador
     where id = v_venta.venta_mostrador_id for update;
    v_documento := v_vm.numero;
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;

  if v_venta.anulado_at is not null then
    raise exception 'Esta venta ya fue anulada';
  end if;

  -- TODO(DIAN): cuando exista la facturación electrónica, una venta con
  -- factura emitida no se anula aquí: debe emitirse una nota crédito ante la
  -- DIAN, y esta función tiene que rechazarla o delegar en ese flujo. Hoy Glazz
  -- no emite facturas electrónicas.

  -- ── Validaciones (antes de escribir nada) ──

  -- Financiera: el dinero no entró a caja, así que no hay egreso. Si la
  -- financiera ya desembolsó, la devolución se negocia con ella.
  if v_venta.metodo_pago = 'financiera' then
    if v_venta.desembolso_id is not null then
      select nombre into v_financiera from public.financieras where id = v_venta.financiera_id;
      raise exception 'El desembolso de % para esta venta ya fue registrado: la anulación requiere gestión manual con la financiera',
        coalesce(v_financiera, 'la financiera');
    end if;
  else
    -- El reverso va a la caja original si sigue abierta. Si ya cerró, va a la
    -- caja abierta de hoy: una caja cerrada nunca se toca.
    select * into v_original from public.cash_register_sessions
     where id = v_venta.session_id for update;

    if v_original.status = 'open'::public.estado_caja then
      v_sesion := v_original;
    else
      select * into v_sesion from public.cash_register_sessions
       where status = 'open'::public.estado_caja and empresa_id = v_empresa
       for update;
      if not found then
        raise exception 'No hay caja abierta: abre la caja para registrar el reverso de esta venta (su caja original ya fue cerrada)';
      end if;
      v_afecta := v_venta.metodo_pago <> 'efectivo' or coalesce(p_sale_efectivo, true);
    end if;

    if v_venta.metodo_pago = 'efectivo' and v_afecta
       and v_venta.monto > public.efectivo_disponible_caja(v_sesion.id) then
      raise exception 'No hay suficiente efectivo en caja para el reverso: disponible %',
        public.efectivo_disponible_caja(v_sesion.id);
    end if;
  end if;

  -- Cotización: si este es su último cobro activo, la venta se deshace del
  -- todo. La orden solo se cancela si no ha empezado: lo que ya se produjo o
  -- consumió material requiere decidir a mano qué hacer con él.
  if v_venta.cotizacion_id is not null then
    select count(*) into v_otros from public.ventas
     where cotizacion_id = v_venta.cotizacion_id
       and anulado_at is null
       and id <> v_venta.id;

    if v_otros = 0 then
      for v_orden in
        select * from public.ordenes_trabajo
         where cotizacion_id = v_venta.cotizacion_id and estado <> 'cancelada'
         for update
      loop
        if v_orden.estado <> 'pendiente'::public.estado_orden then
          raise exception 'La orden % ya está en estado "%": anular su único cobro requiere gestión manual de la orden',
            v_orden.numero, v_orden.estado;
        end if;
        if exists (select 1 from public.orden_materiales
                    where orden_id = v_orden.id and estado = 'consumido') then
          raise exception 'La orden % ya consumió material del inventario: anular su único cobro requiere decidir qué hacer con ese material',
            v_orden.numero;
        end if;
      end loop;
    end if;
  end if;

  -- ── Escrituras ──

  update public.ventas
     set anulado_at = now(),
         anulado_por = v_usuario,
         motivo_anulacion = v_motivo
   where id = v_venta.id
  returning * into v_venta;

  if v_venta.metodo_pago <> 'financiera' then
    -- Pasa por exigir_caja_del_dia: si la caja abierta es de otro día, hay que
    -- cerrarla primero, como con cualquier movimiento.
    insert into public.caja_movimientos
      (session_id, categoria, concepto, monto, metodo_pago, usuario_id, venta_id, afecta_efectivo)
    values
      (v_sesion.id, 'reverso_anulacion', 'Anulación ' || v_documento || ': ' || v_motivo,
       v_venta.monto, v_venta.metodo_pago, v_usuario, v_venta.id, v_afecta);
  end if;

  if v_venta.cotizacion_id is not null then
    if v_otros = 0 then
      update public.ordenes_trabajo
         set estado = 'cancelada'
       where cotizacion_id = v_venta.cotizacion_id and estado = 'pendiente';

      update public.cotizaciones
         set estado = coalesce(estado_previo_venta, 'aprobada'::public.estado_cotizacion),
             estado_previo_venta = null
       where id = v_venta.cotizacion_id and estado = 'vendida';
    end if;
    -- Con otros cobros activos (el caso del duplicado), la cotización sigue
    -- vendida por el cobro válido y la orden no se toca.
  else
    update public.ventas_mostrador
       set anulado_at = v_venta.anulado_at,
           anulado_por = v_usuario,
           motivo_anulacion = v_motivo
     where id = v_vm.id;

    -- Se reintegra exactamente lo que esta venta descontó, con un movimiento
    -- nuevo, sin editar cantidades. El mostrador vende ítems enteros, sin
    -- corte, así que lo que salió vuelve igual.
    for v_mov in
      select * from public.movimientos_inventario
       where referencia = v_vm.id::text and tipo = 'salida' and empresa_id = v_empresa
       order by created_at
    loop
      select * into v_item from public.items_inventario
       where id = v_mov.item_id for update;

      insert into public.movimientos_inventario
        (item_id, tipo, cantidad, cantidad_anterior, cantidad_posterior, motivo, referencia, usuario_id)
      values
        (v_item.id, 'reintegro_anulacion', v_mov.cantidad, v_item.stock_actual,
         v_item.stock_actual + v_mov.cantidad,
         'Anulación venta ' || v_vm.numero, v_vm.id::text, v_usuario);
    end loop;
  end if;

  return v_venta;
end;
$function$;

revoke execute on function public.anular_venta(uuid, text, boolean) from public, anon;
grant execute on function public.anular_venta(uuid, text, boolean) to authenticated;

revoke execute on function public.ventas_inmutable() from public, anon, authenticated;
