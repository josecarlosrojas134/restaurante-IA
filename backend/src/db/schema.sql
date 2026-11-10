-- ============================================================
-- SavorAI - Esquema de base de datos (PostgreSQL 16)
-- Sistema de restaurante con asistente de IA
-- ============================================================

-- ---------- ENUMS ----------
CREATE TYPE rol_usuario AS ENUM ('admin', 'jefe_sala', 'camarero', 'cocina', 'caja');
CREATE TYPE estado_mesa AS ENUM ('libre', 'ocupada', 'reservada', 'cuenta_solicitada', 'limpieza', 'mantenimiento');
CREATE TYPE estado_comanda AS ENUM ('pendiente', 'en_cocina', 'lista', 'entregada', 'cobrada', 'cancelada');
CREATE TYPE estado_linea AS ENUM ('pendiente', 'en_preparacion', 'lista', 'servida', 'cancelada');
CREATE TYPE canal_comanda AS ENUM ('salon', 'takeaway', 'delivery', 'barra');
CREATE TYPE estado_cuenta AS ENUM ('abierta', 'cuenta_solicitada', 'dividida', 'cobrada');
CREATE TYPE estado_reserva AS ENUM ('pendiente', 'confirmada', 'en_curso', 'atendida', 'retrasada', 'no_show', 'cancelada');
CREATE TYPE estado_lista_espera AS ENUM ('esperando', 'notificada', 'sentada', 'salida');
CREATE TYPE estado_linea_orden AS ENUM ('borrador', 'enviada', 'recibida', 'completada', 'cancelada');
CREATE TYPE estado_orden_compra AS ENUM ('pendiente', 'aprobada', 'enviada', 'recibida', 'cancelada');
CREATE TYPE origen_reserva AS ENUM ('manual', 'thefork', 'google', 'telefono', 'web', 'ia');
CREATE TYPE metodo_pago AS ENUM ('tarjeta', 'efectivo', 'cheque_gourmet', 'digital', 'bizum');
CREATE TYPE tipo_descuento AS ENUM ('promocion_ia', 'fidelizacion', 'ajuste_manual', 'happy_hour');
CREATE TYPE tipo_recomendacion AS ENUM ('stock_critico', 'upsell', 'personalizacion', 'clima', 'personal', 'ocupacion', 'demora', 'maridaje');

-- ---------- BASE / ORGANIZACIÓN ----------
CREATE TABLE locales (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(100) NOT NULL,
    direccion       VARCHAR(200),
    telefono        VARCHAR(30),
    tpv_id          VARCHAR(30),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE zonas (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    nombre          VARCHAR(80) NOT NULL,            -- Salón Interior, Patio/Terraza
    nombre_corto    VARCHAR(40),
    tipo            VARCHAR(30) NOT NULL DEFAULT 'interior', -- interior, exterior, barra, vip
    padre_id        INTEGER REFERENCES zonas(id),    -- sub-secciones (Barra, Pérgola, VIP)
    capacidad_max   INTEGER,                         -- comensales máximos
    clima_config    JSONB,                           -- { climatizacion: 21, calefaccion: true }
    orden           INTEGER NOT NULL DEFAULT 0,
    activo          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE usuarios (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    nombre          VARCHAR(100) NOT NULL,
    email           VARCHAR(150) UNIQUE,
    password_hash   VARCHAR(200),
    rol             rol_usuario NOT NULL DEFAULT 'camarero',
    iniciales       VARCHAR(5),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE turnos (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    nombre          VARCHAR(60) NOT NULL,            -- Turno Noche
    fecha           DATE NOT NULL,
    hora_apertura   TIME NOT NULL,
    hora_cierre     TIME,
    abierto         BOOLEAN NOT NULL DEFAULT TRUE,
    cerrado_en      TIMESTAMPTZ,
    UNIQUE (locale_id, nombre, fecha)
);

CREATE TABLE asignaciones_turno (
    id              SERIAL PRIMARY KEY,
    turno_id        INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    zona_id         INTEGER REFERENCES zonas(id),
    UNIQUE (turno_id, usuario_id, zona_id)
);

CREATE TABLE mesas (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    zona_id         INTEGER NOT NULL REFERENCES zonas(id),
    codigo          VARCHAR(10) NOT NULL,            -- M-01, P-04
    capacidad       INTEGER NOT NULL DEFAULT 4,
    forma           VARCHAR(20) NOT NULL DEFAULT 'rectangular', -- redonda, rectangular, barra
    estado          estado_mesa NOT NULL DEFAULT 'libre',
    posX            INTEGER,                         -- posición en el plano (grid)
    posY            INTEGER,
    ambiente        VARCHAR(60),                     -- Pérgola, Jardín Central...
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (locale_id, codigo)
);

-- ---------- MENÚ ----------
CREATE TABLE categorias_menu (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    nombre          VARCHAR(80) NOT NULL,            -- Entrantes & Tapas
    icono           VARCHAR(40),
    orden           INTEGER NOT NULL DEFAULT 0,
    activa          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE alergenos (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(60) NOT NULL UNIQUE,     -- Gluten, Lácteos, Frutos Secos...
    icono           VARCHAR(40)
);

CREATE TABLE etiquetas (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(60) NOT NULL UNIQUE,     -- Top Ventas, Vegetariano, Especial Chef...
    color           VARCHAR(20) DEFAULT 'neutral'
);

CREATE TABLE platos (
    id              SERIAL PRIMARY KEY,
    categoria_id    INTEGER NOT NULL REFERENCES categorias_menu(id),
    nombre          VARCHAR(120) NOT NULL,
    descripcion     TEXT,
    precio          NUMERIC(10,2) NOT NULL,
    costo           NUMERIC(10,2),                   -- para cálculo de margen
    tiempo_prep_min INTEGER DEFAULT 10,
    imagen_url      VARCHAR(300),
    es_vegetariano  BOOLEAN NOT NULL DEFAULT FALSE,
    es_vegano       BOOLEAN NOT NULL DEFAULT FALSE,
    disponible      BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = 86'd
    orden           INTEGER NOT NULL DEFAULT 0,
    UNIQUE (categoria_id, nombre)
);

CREATE TABLE plato_alergeno (
    plato_id        INTEGER NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
    alergeno_id     INTEGER NOT NULL REFERENCES alergenos(id) ON DELETE CASCADE,
    PRIMARY KEY (plato_id, alergeno_id)
);

CREATE TABLE plato_etiqueta (
    plato_id        INTEGER NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
    etiqueta_id     INTEGER NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
    PRIMARY KEY (plato_id, etiqueta_id)
);

CREATE TABLE estaciones (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(60) NOT NULL,            -- Fuego 4, Horno B, Bandeja 1, Pase Expo
    tipo            VARCHAR(40)
);

-- ---------- INVENTARIO ----------
CREATE TABLE proveedores (
    id              SERIAL PRIMARY KEY,
    nombre          VARCHAR(120) NOT NULL,
    contacto        VARCHAR(120),
    telefono        VARCHAR(30),
    email           VARCHAR(150),
    plazo_entrega_dias INTEGER DEFAULT 2
);

CREATE TABLE insumos (
    id              SERIAL PRIMARY KEY,
    proveedor_id    INTEGER REFERENCES proveedores(id),
    nombre          VARCHAR(120) NOT NULL,
    unidad          VARCHAR(20) NOT NULL,            -- kg, ud, lt
    stock_actual    NUMERIC(12,3) NOT NULL DEFAULT 0,
    stock_minimo    NUMERIC(12,3) NOT NULL DEFAULT 0,
    costo_unitario  NUMERIC(10,2) NOT NULL DEFAULT 0,
    perecedero      BOOLEAN NOT NULL DEFAULT FALSE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE recetas (
    id              SERIAL PRIMARY KEY,
    plato_id        INTEGER NOT NULL REFERENCES platos(id) ON DELETE CASCADE,
    insumo_id       INTEGER NOT NULL REFERENCES insumos(id),
    cantidad        NUMERIC(12,3) NOT NULL,          -- cantidad por ración
    UNIQUE (plato_id, insumo_id)
);

CREATE TABLE movimientos_inventario (
    id              SERIAL PRIMARY KEY,
    insumo_id       INTEGER NOT NULL REFERENCES insumos(id),
    tipo            VARCHAR(20) NOT NULL,            -- entrada, salida, ajuste, merma, pedido
    cantidad        NUMERIC(12,3) NOT NULL,
    motivo          VARCHAR(200),
    usuario_id      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ordenes_compra (
    id              SERIAL PRIMARY KEY,
    proveedor_id    INTEGER NOT NULL REFERENCES proveedores(id),
    estado          estado_orden_compra NOT NULL DEFAULT 'pendiente',
    total           NUMERIC(12,2) DEFAULT 0,
    origen_ia       BOOLEAN NOT NULL DEFAULT FALSE,  -- generada por el asistente
    creada_por      INTEGER REFERENCES usuarios(id),
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recibida_en     TIMESTAMPTZ
);

CREATE TABLE lineas_orden_compra (
    id              SERIAL PRIMARY KEY,
    orden_id        INTEGER NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
    insumo_id       INTEGER NOT NULL REFERENCES insumos(id),
    cantidad        NUMERIC(12,3) NOT NULL,
    costo_unitario  NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- ---------- PEDIDOS / COMANDAS ----------
CREATE TABLE comandas (
    id              SERIAL PRIMARY KEY,
    numero          VARCHAR(12) NOT NULL,            -- #1042, #2041
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    mesa_id         INTEGER REFERENCES mesas(id),
    turno_id        INTEGER NOT NULL REFERENCES turnos(id),
    camarero_id     INTEGER REFERENCES usuarios(id),
    cliente_id      INTEGER,                         -- FK añadida después (reservas/clientes)
    comensales      INTEGER NOT NULL DEFAULT 1,
    canal           canal_comanda NOT NULL DEFAULT 'salon',
    estado          estado_comanda NOT NULL DEFAULT 'pendiente',
    canal_externo   VARCHAR(30),                     -- glovo, ubereats, thefork...
    pedido_externo_id VARCHAR(30),                   -- #284 de UberEats
    repartidor      VARCHAR(80),
    prioridad       INTEGER NOT NULL DEFAULT 0,
    abierta_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enviada_cocina_en TIMESTAMPTZ,
    lista_en        TIMESTAMPTZ,
    entregada_en    TIMESTAMPTZ,
    cerrada_en      TIMESTAMPTZ,
    notas           TEXT,
    UNIQUE (locale_id, numero)
);

CREATE TABLE lineas_comanda (
    id              SERIAL PRIMARY KEY,
    comanda_id      INTEGER NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    plato_id        INTEGER NOT NULL REFERENCES platos(id),
    cantidad        INTEGER NOT NULL DEFAULT 1,
    precio_unitario NUMERIC(10,2) NOT NULL,
    asiento         INTEGER,                         -- asignación por asiento (1..N)
    partida         VARCHAR(30) NOT NULL DEFAULT 'principal', -- entrante, principal, postre, bebida
    estado          estado_linea NOT NULL DEFAULT 'pendiente',
    estacion_id     INTEGER REFERENCES estaciones(id),
    notas           TEXT,                            -- "Poco hecho", "Salsa aparte"
    alerta_alergeno TEXT,
    fuego           VARCHAR(20),                     -- Fuego 4, Horno B...
    preparada_en    TIMESTAMPTZ,
    servida_en      TIMESTAMPTZ
);

CREATE TABLE historial_estados_comanda (
    id              SERIAL PRIMARY KEY,
    comanda_id      INTEGER NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    estado          estado_comanda NOT NULL,
    cambiado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usuario_id      INTEGER REFERENCES usuarios(id)
);

CREATE TABLE descuentos_comanda (
    id              SERIAL PRIMARY KEY,
    comanda_id      INTEGER NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    tipo            tipo_descuento NOT NULL,
    porcentaje      NUMERIC(5,2) DEFAULT 0,
    monto           NUMERIC(10,2) DEFAULT 0,
    motivo          VARCHAR(200),
    aplicado_por    INTEGER REFERENCES usuarios(id),
    aplicado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- CUENTAS Y PAGOS ----------
CREATE TABLE cuentas (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    mesa_id         INTEGER REFERENCES mesas(id),
    turno_id        INTEGER NOT NULL REFERENCES turnos(id),
    numero          VARCHAR(12) NOT NULL,
    estado          estado_cuenta NOT NULL DEFAULT 'abierta',
    subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
    iva_pct         NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    iva_monto       NUMERIC(10,2) NOT NULL DEFAULT 0,
    descuento       NUMERIC(10,2) NOT NULL DEFAULT 0,
    total           NUMERIC(10,2) NOT NULL DEFAULT 0,
    abierta_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cobrada_en      TIMESTAMPTZ,
    UNIQUE (locale_id, numero)
);

CREATE TABLE cuenta_comanda (
    cuenta_id       INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
    comanda_id      INTEGER NOT NULL REFERENCES comandas(id) ON DELETE CASCADE,
    PRIMARY KEY (cuenta_id, comanda_id)
);

CREATE TABLE pagos (
    id              SERIAL PRIMARY KEY,
    cuenta_id       INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
    metodo          metodo_pago NOT NULL,
    monto           NUMERIC(10,2) NOT NULL,
    propina         NUMERIC(10,2) NOT NULL DEFAULT 0,
    referencia      VARCHAR(80),
    usuario_id      INTEGER REFERENCES usuarios(id),
    pagado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reparto_propinas (
    id              SERIAL PRIMARY KEY,
    pago_id         INTEGER NOT NULL REFERENCES pagos(id) ON DELETE CASCADE,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    monto           NUMERIC(10,2) NOT NULL
);

CREATE TABLE cierres_caja (
    id              SERIAL PRIMARY KEY,
    turno_id        INTEGER NOT NULL REFERENCES turnos(id),
    usuario_id      INTEGER REFERENCES usuarios(id),
    total_bruto     NUMERIC(12,2) NOT NULL DEFAULT 0,
    iva_repercutido NUMERIC(12,2) NOT NULL DEFAULT 0,
    base_imponible  NUMERIC(12,2) NOT NULL DEFAULT 0,
    efectivo        NUMERIC(12,2) NOT NULL DEFAULT 0,
    tarjeta         NUMERIC(12,2) NOT NULL DEFAULT 0,
    cheques         NUMERIC(12,2) NOT NULL DEFAULT 0,
    digital         NUMERIC(12,2) NOT NULL DEFAULT 0,
    propinas        NUMERIC(12,2) NOT NULL DEFAULT 0,
    arqueo_esperado NUMERIC(12,2) NOT NULL DEFAULT 0,
    arqueo_real     NUMERIC(12,2) NOT NULL DEFAULT 0,
    diferencia      NUMERIC(12,2) NOT NULL DEFAULT 0,
    cerrado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (turno_id)
);

-- ---------- CLIENTES Y RESERVAS / CRM ----------
CREATE TABLE clientes (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    nombre          VARCHAR(120) NOT NULL,
    telefono        VARCHAR(30),
    email           VARCHAR(150),
    sector          VARCHAR(80),                     -- Sector Audiovisual
    fecha_nacimiento DATE,
    nivel_vip       VARCHAR(30) DEFAULT 'ninguno',   -- platino, oro, ninguno
    fidelizado      BOOLEAN NOT NULL DEFAULT FALSE,
    miembro_desde   DATE NOT NULL DEFAULT CURRENT_DATE,
    visitas_total   INTEGER NOT NULL DEFAULT 0,
    gasto_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
    ticket_medio    NUMERIC(10,2) NOT NULL DEFAULT 0,
    ultima_visita   DATE,
    notas           TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE preferencias_cliente (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    tipo            VARCHAR(40) NOT NULL,            -- alergia, preferencia, nota
    clave           VARCHAR(80) NOT NULL,            -- Frutos Secos, Prefiere Patio...
    valor           TEXT,
    severidad       VARCHAR(20) DEFAULT 'normal',    -- normal, media, critica
    UNIQUE (cliente_id, clave)
);

CREATE TABLE reservas (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    turno_id        INTEGER REFERENCES turnos(id),
    fecha           DATE NOT NULL,
    hora            TIME NOT NULL,
    comensales      INTEGER NOT NULL,
    duracion_est_min INTEGER NOT NULL DEFAULT 105,
    origen          origen_reserva NOT NULL DEFAULT 'manual',
    estado          estado_reserva NOT NULL DEFAULT 'confirmada',
    mesa_id         INTEGER REFERENCES mesas(id),
    zona_pref_id    INTEGER REFERENCES zonas(id),
    confirmada_via  VARCHAR(30),                     -- sms, email, thefork
    id_externo      VARCHAR(40),                     -- id en TheFork/Google
    notas           TEXT,
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sentada_en      TIMESTAMPTZ,
    UNIQUE (fecha, hora, cliente_id, mesa_id)
);

-- reservas que ocupan varias mesas (M-08 + M-09 unidas)
CREATE TABLE reserva_mesas (
    reserva_id      INTEGER NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
    mesa_id         INTEGER NOT NULL REFERENCES mesas(id),
    PRIMARY KEY (reserva_id, mesa_id)
);

CREATE TABLE lista_espera (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    turno_id        INTEGER REFERENCES turnos(id),
    comensales      INTEGER NOT NULL,
    estado          estado_lista_espera NOT NULL DEFAULT 'esperando',
    zona_pref_id    INTEGER REFERENCES zonas(id),
    tiempo_espera_est_min INTEGER,
    posicion        INTEGER,
    registrado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notificado_en   TIMESTAMPTZ,
    sentado_en      TIMESTAMPTZ,
    salida_en       TIMESTAMPTZ,
    notas           TEXT
);

CREATE TABLE resenas (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id),
    comanda_id      INTEGER REFERENCES comandas(id),
    puntuacion      SMALLINT NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
    comentario      TEXT,
    fecha           DATE NOT NULL DEFAULT CURRENT_DATE
);

-- FK de comandas a clientes (deferred: clientes viene después en el orden)
ALTER TABLE comandas
    ADD CONSTRAINT fk_comandas_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id);

-- ---------- ASISTENTE IA ----------
CREATE TABLE conversaciones_ia (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
    titulo          VARCHAR(160),
    iniciada_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activa          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE mensajes_ia (
    id              SERIAL PRIMARY KEY,
    conversacion_id INTEGER NOT NULL REFERENCES conversaciones_ia(id) ON DELETE CASCADE,
    rol             VARCHAR(10) NOT NULL,            -- user | assistant
    contenido       TEXT NOT NULL,
    metadatos       JSONB,                           -- tablas, métricas citadas
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE recomendaciones_ia (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    turno_id        INTEGER REFERENCES turnos(id),
    tipo            tipo_recomendacion NOT NULL,
    titulo          VARCHAR(160) NOT NULL,
    contenido       TEXT NOT NULL,
    confianza       NUMERIC(5,2),                    -- 0-100
    datos           JSONB,                           -- payload estructurado
    estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente, aplicada, descartada
    accion_ejecutada VARCHAR(120),                   -- notificacion_enviada, orden_creada...
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resuelta_en     TIMESTAMPTZ
);

CREATE TABLE predicciones_demanda (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    zona_id         INTEGER REFERENCES zonas(id),
    fecha           DATE NOT NULL,
    hora            TIME NOT NULL,
    ocupacion_proyectada NUMERIC(5,2),               -- 0-100
    ocupacion_real  NUMERIC(5,2),
    ingresos_proyectados NUMERIC(12,2),
    factor_clima    JSONB,                           -- { temp: 22, lluvia: false }
    creada_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (locale_id, zona_id, fecha, hora)
);

-- ---------- SOPORTE ----------
CREATE TABLE notificaciones (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER REFERENCES usuarios(id),
    tipo            VARCHAR(40) NOT NULL,            -- sms, interno, push
    destino         VARCHAR(120),                    -- teléfono o usuario
    titulo          VARCHAR(160),
    contenido       TEXT NOT NULL,
    leida           BOOLEAN NOT NULL DEFAULT FALSE,
    enviada_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error           TEXT
);

CREATE TABLE exportaciones_informes (
    id              SERIAL PRIMARY KEY,
    usuario_id      INTEGER REFERENCES usuarios(id),
    tipo            VARCHAR(40) NOT NULL,            -- pdf, xls
    nombre          VARCHAR(160) NOT NULL,
    parametros      JSONB,
    ruta            VARCHAR(300),
    generado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dispositivos_iot (
    id              SERIAL PRIMARY KEY,
    locale_id       INTEGER NOT NULL REFERENCES locales(id),
    tipo            VARCHAR(40) NOT NULL,            -- camara, sensor_clima, sensor_presencia
    nombre          VARCHAR(100) NOT NULL,
    zona_id         INTEGER REFERENCES zonas(id),
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_estado   JSONB,
    ultima_lectura  TIMESTAMPTZ
);

-- ---------- ÍNDICES ----------
CREATE INDEX idx_comandas_estado ON comandas(estado);
CREATE INDEX idx_comandas_turno ON comandas(turno_id);
CREATE INDEX idx_comandas_mesa ON comandas(mesa_id);
CREATE INDEX idx_lineas_comanda ON lineas_comanda(comanda_id);
CREATE INDEX idx_mesas_estado ON mesas(estado);
CREATE INDEX idx_mesas_zona ON mesas(zona_id);
CREATE INDEX idx_reservas_fecha ON reservas(fecha, hora);
CREATE INDEX idx_reservas_estado ON reservas(estado);
CREATE INDEX idx_pagos_cuenta ON pagos(cuenta_id);
CREATE INDEX idx_movimientos_insumo ON movimientos_inventario(insumo_id, creado_en);
CREATE INDEX idx_recomendaciones_estado ON recomendaciones_ia(estado, creada_en);
CREATE INDEX idx_clientes_telefono ON clientes(telefono);
