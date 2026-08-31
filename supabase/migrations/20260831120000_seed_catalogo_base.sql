-- Semillas del catalogo base. Estas tres tablas se poblaron a mano por el editor
-- SQL de Supabase y nunca quedaron en una migracion, asi que hoy el entorno no se
-- puede reconstruir desde cero: sin filas en tipos_producto no se puede crear ni
-- una sola plantilla (plantillas_producto.tipo_producto_id es not null) y la
-- plantilla Excel de importacion de productos sale sin catalogos validos.
--
-- Los valores replican exactamente los de produccion. Con on conflict do nothing
-- la migracion es idempotente y segura de aplicar sobre la base ya poblada: no
-- pisa descripciones ni iconos que se hayan ajustado despues.

insert into public.tipos_producto (nombre, descripcion, activo) values
    ('ventana',  'Ventanas de aluminio y vidrio',    true),
    ('puerta',   'Puertas de aluminio y vidrio',     true),
    ('division', 'Divisiones y mamparas',            true),
    ('espejo',   'Espejos decorativos y funcionales', true),
    ('otro',     'Otros productos personalizados',   true)
on conflict (nombre) do nothing;

insert into public.unidades_medida (nombre, simbolo, tipo) values
    ('Metro cuadrado', 'm²',   'area'),
    ('Metro lineal',   'ml',   'longitud'),
    ('Unidad',         'und',  'unidad'),
    ('Tubo',           'tubo', 'unidad'),
    ('Kilogramo',      'kg',   'peso')
on conflict (nombre) do nothing;

insert into public.categorias (nombre, descripcion, icono, activa) values
    ('Perfil de aluminio', 'Perfiles y marcos de aluminio',          'minus',   true),
    ('Vidrio',             'Láminas y tipos de vidrio',              'square',  true),
    ('Herrajes',           'Bisagras, cerraduras y accesorios metal', 'tool',    true),
    ('Sellantes',          'Silicona, sellantes y cintas',           'droplet', true),
    ('Accesorios',         'Accesorios varios para instalación',     'package', true)
on conflict (nombre) do nothing;
