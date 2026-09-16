# Ventas a crédito con financieras (Addi, Sistecrédito)

Cómo registra Glazz una venta en la que el cliente paga con un crédito de Addi o
Sistecrédito, y por qué los reportes la tratan distinto a un pago normal.

## Cómo funciona el negocio

1. El cliente pide el crédito en la tienda (app o WhatsApp de la financiera) y queda aprobado.
2. La financiera le cobra las cuotas al cliente. Glazz no cobra nada más al cliente.
3. La financiera le **desembolsa la venta a la vidriería** días después, según el
   convenio (Addi ofrece planes de 7, 30 o 60 días), **con su comisión ya descontada**.

Por eso una venta a crédito tiene tres momentos que no coinciden:

| Momento | Qué pasa | Dónde se ve en Glazz |
|---|---|---|
| Venta | El cliente queda a paz y salvo; la orden puede producirse | Cotización con saldo 0, pago "Crédito financiera" |
| Pendiente | La financiera nos debe | Reportes → Financieras, Dashboard "Por desembolsar" |
| Desembolso | Llega al banco lo vendido menos la comisión | Reportes → Ingresos (bancario) y Financieras |

## Reglas

- **El crédito cubre el total** de la cotización o de la venta de mostrador. No se
  combina con efectivo ni con abonos: si la cotización ya tiene pagos, la opción no aparece.
- **No toca la caja.** No suma al efectivo esperado del cierre ni al arqueo.
- **La comisión estimada** se calcula al vender con el % configurado en
  Configuración → Financieras y queda congelada en el pago. Cambiar el % después no
  modifica ventas pasadas.
- **La comisión real** es lo vendido menos lo que llegó al banco. Se conoce al registrar el desembolso.
- **Un desembolso puede cubrir varias ventas** de la misma financiera.

## Operación diaria

**Vender a crédito:** en el cobro de la cotización (primer pago) o en Caja → Vender,
elige "Crédito financiera", la financiera y, si la tienes, la referencia o código de aprobación.

**Cuando llega una transferencia de la financiera:**

1. Ve a Reportes → Financieras y filtra por la financiera.
2. Marca las ventas que cubre (la liquidación del portal de la financiera dice cuáles son).
3. Pulsa "Registrar desembolso" y escribe el monto exacto del extracto, la fecha en que llegó y la cuenta.
4. Revisa la comisión real antes de confirmar: si no cuadra con el convenio, suele
   faltar o sobrar una venta marcada.

**Si te equivocaste:** un admin puede anular el desembolso desde el historial. Sus
ventas vuelven a quedar pendientes y el registro anulado se conserva con su motivo.

Las ventas cuyo tiempo pendiente pasa del plazo configurado salen en rojo: conviene
reclamarlas a la financiera.

## Cómo leer los reportes

- **Ventas por período:** lo vendido, sin importar el medio de pago.
- **Ingresos:** solo el dinero que **entró**. El efectivo y las transferencias cuentan el
  día del pago; los créditos de financiera, el día del desembolso y por lo recibido.
  Lo vendido a crédito aparece en su propia tarjeta y en la columna "A crédito", que no suma al total.
- **Financieras:** lo que debe cada una, los desembolsos del período y la comisión estimada frente a la real.

## Fuera de alcance

- **Devoluciones o anulaciones de una venta a crédito.** Glazz no anula pagos con
  ningún medio. La anulación se hace en el portal de la financiera, antes de despachar
  el pedido y antes de que el cliente pague la primera cuota.
- **Integración automática con las APIs de Addi o Sistecrédito.** El registro es manual.

## Referencia técnica

- **Migraciones:**
  - `20260916090000_metodo_pago_financiera.sql`: valor de enum.
  - `20260916090100_financieras.sql`: tablas, trigger, RPC y vistas.
- **Tablas:**
  - `financieras`: escritura solo admin.
  - `financiera_desembolsos`: se escribe solo por RPC.
  - Columnas `financiera_id`, `referencia_financiera`, `comision_estimada` y `desembolso_id` en `ventas`.
- **Reglas:** en el trigger `validar_pago_cotizacion`, que también limpia `desembolso_id` en cada insert.
- **RPC:**
  - `registrar_desembolso_financiera` y `anular_desembolso_financiera` (solo admin).
  - `registrar_anticipo_cotizacion` y `registrar_venta_mostrador` reciben `p_financiera_id` y `p_referencia_financiera`.
- **Vistas:**
  - `financieras_por_cobrar`.
  - `caja_sesiones_resumen`, que ahora tiene `total_financiera`.
- **Frontend:**
  - `src/hooks/useFinancieras.ts`
  - `src/pages/reportes/FinancierasTab.tsx`
  - `src/components/shared/CamposFinanciera.tsx`
  - Helpers en `src/lib/pagos.ts`
