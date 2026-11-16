# Papel y Luna · Django y PostgreSQL 18

POS de papelería con el frontend existente en HTML/CSS/JavaScript y una API Django conectada exclusivamente a PostgreSQL. Incluye ventas abiertas, facturas, compras, inventario, clientes, proveedores y categorías. El ZIP de la actividad 09 se tomó como referencia de Django/ORM; los ejemplos de juego se adaptaron al dominio de facturación.

Integrantes: Junior Perez Davila, Claudia Libertad Quispe Terrones y Samuel Andres Zona Malaver.

## Ejecutar

Requisitos: Python 3.10 o superior, PostgreSQL **18** instalado y encendido, y acceso a Internet en el primer arranque para instalar las dependencias.

1. Copia `.env.example` como `.env` y configura `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` y `DB_NAME` con tus datos locales. No subas `.env` a Git.
2. Desde la raíz ejecuta:

   ```powershell
   py run.py
   ```

3. Abre **http://127.0.0.1:8000**. Detén el servicio con `Ctrl+C`.

`run.py` crea `.venv`, instala las versiones de `requirements.lock.txt` cuando hace falta, verifica PostgreSQL 18, crea la base si no existe, aplica migraciones, carga el seed (datos de ejemplo y usuarios iniciales) una sola vez e inicia frontend y API en el mismo puerto. No necesitas activar el entorno virtual. Si no has definido contraseña, la pide de forma oculta en una terminal interactiva. El usuario de PostgreSQL necesita `CREATEDB` solamente si la base todavía no existe; también puedes crearla previamente con pgAdmin.

Al abrir el sitio pedirá iniciar sesión (ver [Autenticación y roles](#autenticación-y-roles) para las credenciales de ejemplo).

```powershell
Copy-Item .env.example .env
# Editar .env con tus credenciales locales
py run.py --check       # Preparar base, migrar, sembrar y verificar sin servidor
py run.py --no-seed     # Iniciar sin cargar ejemplos
```

No abras `index.html` con doble clic ni con Live Server: las llamadas `/api/` se resuelven en el servidor Django. Los datos de `js/config.js` personalizan el comercio en las facturas.

Si `python` apunta al alias de Microsoft Store, usa `py run.py` o el ejecutable real de Python. Si tu `py` por defecto resuelve a una build "free-threaded" (ejecutable `python3.13t`), `run.py` lo detecta antes de crear `.venv` y pide usar una build estándar, por ejemplo `py -3.12 run.py` o `py -3.13 run.py` (lista tus instalaciones con `py -0p`); esas builds no tienen wheels de `psycopg-binary`. Si falla la conexión, comprueba el servicio PostgreSQL, puerto, contraseña y privilegios. Para diagnosticar Django, una vez instalado el entorno:

```powershell
.venv/Scripts/python.exe manage.py check --database default
.venv/Scripts/python.exe manage.py migrate --fake-initial
```

## Estructura y actividad 10

| Archivo/carpeta | Responsabilidad |
| --- | --- |
| `facturacion/models.py` | Entidades ORM, relaciones, restricciones y `RequestLog` |
| `facturacion/controllers/` | Controladores por recurso, autenticación y diagnósticos HTTP |
| `facturacion/validators.py` | Serializers DRF: tipos JSON, campos requeridos, formatos, rangos y referencias |
| `facturacion/services.py` | Negocio: totales, inventario, reintentos y transacciones |
| `facturacion/accounts.py` | Login/sesión por token y el mapa único de permisos recurso+método → rol |
| `facturacion/auth.py` | Autenticación Bearer y permisos DRF (consumen `accounts.py`) |
| `facturacion/serializers.py` | Representación de salida compatible con el frontend |
| `facturacion/middleware.py` | Preprocesamiento de logging (incluye usuario autenticado) y postprocesamiento de JSON |
| `facturacion/migrations/` | Historial versionado del esquema |
| `sql/schema.sql` | Esquema PostgreSQL generado desde las migraciones |
| `sql/seed.sql` | Datos de ejemplo separados, sin sobrescribir existentes |
| `sql/usuarios_iniciales.sql` | Alternativa SQL manual a `manage.py seed` para los usuarios iniciales |
| `postman/actividad_10.postman_collection.json` | 35 solicitudes para la demostración (incluye login y descuentos) |

El ciclo de solicitud es: cliente → logging → controlador → validator → servicio → ORM/PostgreSQL → controlador → sanitización → cliente. Los validators se invocan desde el servicio antes de modificar datos; son reutilizables y no son middlewares. Logging registra método, ruta, IP y fecha **antes** de llamar al controlador, incluyendo solicitudes inválidas y archivos estáticos. La ruta se limita a 255 caracteres y no se guardan cuerpos, contraseñas ni encabezados.

La sanitización elimina recursivamente claves terminadas en `_id` de objetos y listas JSON, preservando `id` y las relaciones públicas `categoriaId`, `clienteId`, `proveedorId` y `productoId`. El controlador de productos genera `categoria_id` y `categoriaId`: la respuesta HTTP conserva únicamente el segundo. `/api/demo/sanitizacion/` permite demostrar el mismo efecto con datos anidados. Los arrays guardados en `itemsJson` son texto JSON, conservado por compatibilidad; sus claves públicas no tienen sufijo `_id`.

Django aplica los middlewares en orden de arriba a abajo en request y de abajo a arriba en response. Ambos están registrados en `backend/settings.py`.

## Autenticación y roles

Todos los endpoints de `/api/` exigen un token, excepto `POST /api/auth/login/`. El token se envía como `Authorization: Bearer <token>` y vence a las `SESSION_TTL_HOURS` horas (12 por defecto, configurable en `.env`).

| Endpoint | Descripción |
| --- | --- |
| `POST /api/auth/login/` | Body `{"usuario": "...", "contrasena": "..."}`. Responde `{token, usuario: {id, usuario, rol}}` o 401 si las credenciales son incorrectas. |
| `POST /api/auth/logout/` | Invalida el token actual. |
| `GET /api/auth/me/` | Datos del usuario autenticado. |

Sin token o con token inválido/vencido: 401. Con token válido pero rol sin permiso: 403. Las contraseñas se guardan con los hashers de Django (`pbkdf2_sha256`); no se usa `django.contrib.auth` como app, solo esa utilidad.

### Usuarios de ejemplo

Creados por `manage.py seed` (o `sql/usuarios_iniciales.sql` como alternativa manual) la primera vez que se siembra la base. Cámbialas antes de un despliegue real; se pueden sobrescribir con `SEED_ADMIN_USER`, `SEED_ADMIN_PASSWORD`, `SEED_CAJERO_USER` y `SEED_CAJERO_PASSWORD` en `.env` **antes** del primer seed (`manage.py seed` no repite el sembrado si ya se ejecutó una vez).

| Usuario | Contraseña | Rol |
| --- | --- | --- |
| `admin` | `admin123` | administrador |
| `cajero` | `cajero123` | cajero |

### Matriz de permisos

Definida en un único lugar, `facturacion/accounts.PERMISSIONS` (recurso + método HTTP → roles). Resumen:

| Recurso | Cajero | Administrador |
| --- | --- | --- |
| `ventas` | CRUD completo | CRUD completo |
| `clientes` | CRUD completo | CRUD completo |
| `productos` | Solo lectura y `PATCH` (edición "en caliente" desde la venta) | CRUD completo |
| `categorias` | Solo lectura | CRUD completo |
| `proveedores` | Sin acceso | CRUD completo |
| `compras` | Sin acceso | CRUD completo |
| `descuentos` | Solo lectura (para aplicarlos en una venta) | CRUD completo |
| `correcciones` (corregir una venta cerrada, ver [Corrección de ventas cerradas](#corrección-de-ventas-cerradas)) | Sin acceso (403) | Único que puede corregir |
| `reembolsos` (reembolsar una venta cerrada, ver [Reembolsos](#reembolsos)) | Sin acceso (403); sí puede ver la marca y el detalle en la propia venta | Único que puede crear reembolsos |

El frontend oculta en el menú lo que el rol no puede usar (Compras, Proveedores, Descuentos y las acciones administrativas de Productos/Categorías), pero quien exige el permiso siempre es el backend.

## Contrato de la API

Base: `http://127.0.0.1:8000/api/`. Cuerpos de escritura con `Content-Type: application/json`.

Para cada recurso `categorias`, `clientes`, `proveedores`, `productos`, `descuentos`, `ventas` y `compras`:

| Método y ruta | Operación |
| --- | --- |
| `GET /api/{recurso}/` | Listado |
| `POST /api/{recurso}/` | Crear (201); `id` UUID opcional |
| `GET /api/{recurso}/{uuid}/` | Detalle |
| `PUT /api/{recurso}/{uuid}/` | Actualizar con todos los campos requeridos |
| `PATCH /api/{recurso}/{uuid}/` | Actualización parcial, utilizada por el frontend |
| `DELETE /api/{recurso}/{uuid}/` | Eliminar si las reglas y referencias lo permiten |

Respuestas: `{"success":true,"data":...}`. Los errores usan `{"success":false,"message":"...","errors":{...}}`; `errors` se incluye cuando hay detalles disponibles. Códigos: 400 datos inválidos, 404 inexistente, 405 método incorrecto, 409 duplicados/referencias/documentos contabilizados y 415 formato no admitido. Si la base no permite registrar la llamada, el middleware devuelve 503.

Los endpoints de listado devuelven todos los registros en esta aplicación de pruebas. `/api/request-logs/` (solo administrador) devuelve los 100 logs más recientes con el usuario que hizo cada llamada, incluyendo el de esa misma solicitud; `/api/health/` verifica conexión y versión. Todos exigen el token de la sección [Autenticación y roles](#autenticación-y-roles). No exponer este servidor de desarrollo a Internet.

### Campos de entrada

- Categoría: `nombre` (texto obligatorio, máximo 120).
- Cliente/proveedor: `nombre` (máximo 150), `telefono` opcional (máximo 40), `correo` opcional válido.
- Producto: `codigo`, `nombre`, `categoriaId` existente, `precio`, `costo`, `seguimientoInventario` booleano, `stock` entero. Los valores monetarios son pesos enteros no negativos; stock y precios tienen máximo 2147483647. Si no se sigue inventario, stock queda en 0.
- Descuento: `nombre` obligatorio, `tipo` (`porcentual` o `fijo`), `valor` entero positivo (`porcentual` además exige `valor <= 100`).
- Venta: `fecha` ISO con hora, `estado` (`abierta`/`cerrada`), `metodoPago` (`Efectivo`/`Nequi`/`Debe`), `valorRecibido`, `clienteId` opcional (UUID, vacío o null), `descuentoId` opcional (UUID, vacío o null; ver [Descuentos](#descuentos)), `itemsJson`.
- Compra: `fecha` (`YYYY-MM-DD`), `proveedorId` existente, `itemsJson`.
- `itemsJson`: string con un arreglo de 1 a 500 objetos con `productoId` y `cantidad` entera positiva. Compra exige además `costo`. Se aceptan `codigo`, `nombre`, `precio`, `costo` enviados por el frontend; el servidor toma nombre/código y precios de venta del catálogo. Las compras conservan el costo ingresado.

Los validators rechazan campos desconocidos, strings en lugar de números, booleanos en lugar de enteros, UUID inválidos, productos repetidos, cantidades negativas, correos incorrectos y referencias inexistentes. PUT valida todos los campos requeridos; PATCH combina los datos con el registro persistido y vuelve a validar las reglas de negocio.

### Inventario e integridad

Las ventas abiertas no descuentan stock. Cerrar una venta calcula sus importes en el servidor y descuenta stock una sola vez. `Debe` requiere cliente al cerrar; efectivo debe cubrir el total. Las compras suman stock y actualizan costo. Los documentos guardan detalles relacionales con instantáneas de los productos, para que una edición posterior del catálogo no cambie facturas anteriores.

Todas las escrituras utilizan `transaction.atomic`, un bloqueo transaccional de PostgreSQL para este POS de pruebas y bloqueos de filas de productos. Dos cierres simultáneos no pueden vender el mismo stock. Un error revierte tanto documento como inventario. Este bloqueo global prioriza consistencia para el taller; serializa las escrituras y no está pensado para alto tráfico.

Ventas cerradas y compras no se pueden editar ni eliminar. Reenviar el mismo documento contabilizado con su UUID devuelve el registro existente sin repetir movimientos. Para reintentar un POST de forma segura, conserva el UUID generado por el frontend: sin `id`, cada POST crea un documento nuevo. Los totales enviados por el cliente son campos calculados: se ignoran y se devuelven los valores del servidor. Eliminar categorías/contactos/productos referenciados devuelve 409.

## Descuentos

Catálogo reutilizable (`GET` para cajero y administrador; crear/editar/eliminar solo administrador, ver [matriz de permisos](#matriz-de-permisos)). Una venta admite como máximo un descuento, aplicado sobre el total (no por producto), con la misma búsqueda y selección que los productos: en el catálogo de "Nueva venta" aparece como una tarjeta con la insignia "Descuento" en vez de cantidad/stock.

**Aplicar o quitar el descuento usa el mismo endpoint de ventas** (`descuentoId` en el body de `POST`/`PUT`/`PATCH /api/ventas/...`), no un sub-recurso aparte: el monto del descuento depende del mismo subtotal que ya se recalcula atómicamente en `services.save_document()` junto con el inventario; separarlo en otro endpoint hubiera significado duplicar esa transacción o manejar dos fuentes de verdad para el total.

En **cada** guardado de la venta (igual que los ítems) se recalcula el *monto* del descuento sobre el subtotal vigente, pero el *nombre/tipo/valor* del descuento solo se vuelve a leer del catálogo cuando `descuentoId` cambia respecto al valor que tenía el registro antes de ese guardado (o cuando la venta es nueva). Si `descuentoId` no cambia, se reutiliza la copia ya congelada en la venta (`descuento_nombre/tipo/valor`) aplicada al nuevo subtotal: así, reabrir y volver a guardar una venta sin cambiar de descuento nunca "recoge" una edición posterior hecha al descuento en el catálogo mientras tanto. Esto se verifica con `DescuentoTests.test_resave_abierta_usa_copia_congelada_no_el_catalogo_editado` y `test_cambiar_a_un_descuento_distinto_si_usa_su_valor_vigente` en `facturacion/tests.py`.

- Cálculo (siempre en el servidor): `porcentual` → `subtotal * valor // 100` (división entera, igual que el resto del dinero en el proyecto); `fijo` → `valor`. `total = subtotal - descuentoMonto`.
- **Si el descuento fijo supera el subtotal, el servidor rechaza la operación con 400** (no lo recorta a cero); se valida al aplicarlo, al guardar la venta abierta y al cerrarla, así que quitar ítems después de aplicar un descuento fijo puede volver a disparar el rechazo.
- Un total en `0` (por ejemplo, 100% de descuento) es válido: con Efectivo/Nequi el valor recibido puede ser `0` (cambio `0`); con Debe sigue exigiendo cliente, aunque el saldo quede en `0`.
- El descuento **no afecta inventario**: el stock solo cambia por ítems de venta/compra.
- **La venta guarda una copia** del descuento aplicado (`descuentoNombre`, `descuentoTipo`, `descuentoValor`, `descuentoMonto`) además de la referencia (`descuentoId`, `on_delete=SET_NULL`). Por eso **eliminar o editar un descuento del catálogo no cambia ninguna venta existente** (ni abierta ni cerrada): solo afecta a las próximas veces que se aplique. Esta es la excepción explícita a la regla general de 409 al eliminar algo referenciado (que sí aplica a categorías/proveedores/productos vía `on_delete=PROTECT`).
- Historial, detalle de venta y factura muestran subtotal, descuento (nombre y monto) y total; si la venta no tiene descuento, no se agrega nada.

`manage.py seed` (y su equivalente manual `sql/seed.sql`) incluyen dos descuentos de ejemplo idempotentes: "Demo 10%" (porcentual) y "Demo $5.000" (fijo).

## Corrección de ventas cerradas

Una venta `cerrada` normalmente está bloqueada: `PUT`/`PATCH`/`DELETE /api/ventas/{uuid}/` devuelven 409 ("documentos ya contabilizados"), igual que una compra cerrada. La corrección es la única vía autorizada para modificarla después de cerrada, y es un **endpoint y un servicio aparte** (`correct_sale` en `facturacion/services.py`) que ignora ese candado a propósito, en vez de debilitarlo en las rutas normales.

`POST /api/ventas/{uuid}/corregir/` — solo administrador (cajero recibe 403; el rol se define en `facturacion.accounts.PERMISSIONS['correcciones']`, el mismo mapa central que el resto de recursos). Si la venta no está cerrada, devuelve 400 (`{"estado": "Solo se pueden corregir ventas cerradas."}`).

Body (nota: **no** incluye `descuentoId`; el descuento no es corregible):

```json
{"itemsJson": "[{\"productoId\": \"...\", \"cantidad\": 3}]", "clienteId": "...", "metodoPago": "Efectivo", "valorRecibido": 15000}
```

Reglas:

- **Ítems**: se puede agregar, quitar o cambiar la cantidad de cualquier producto. Al menos un ítem (RN-01).
- **Precio/costo unitario**: las líneas que ya existían en la venta conservan el precio y costo con el que se guardaron originalmente (su "instantánea"); solo los productos agregados durante la corrección toman el precio/costo vigente del catálogo. Así una corrección no cambia silenciosamente el precio de algo que el cliente ya había pagado a un precio distinto.
- **Descuento**: no se puede cambiar ni quitar. Se conserva tal cual la copia congelada de la venta (nombre/tipo/valor) y solo se recalcula su *monto* sobre el nuevo subtotal. Esto aplica incluso si el descuento del catálogo fue editado o eliminado después de cerrar la venta: la corrección nunca lo vuelve a leer. Si el descuento es fijo y supera el nuevo subtotal, se rechaza con 400 (mismo estilo de error que al cerrar).
- **Cliente y método de pago**: corregibles. `Debe` exige cliente; `Efectivo` exige `valorRecibido >= total` (recalcula el cambio); `Nequi` ignora `valorRecibido` enviado y lo fija en el total.
- **Totales**: `subtotal`, `descuentoMonto`, `total` y `cambio` siempre se recalculan en el servidor (RN-02); lo que envíe el cliente para esos campos se ignora.
- **Inventario (RN-06)**: se ajusta por la **diferencia** entre la cantidad original y la corregida, por producto, y solo para productos con `seguimientoInventario`. Quitar una línea restaura su cantidad completa; bajar la cantidad restaura la diferencia; subirla o agregar un producto nuevo la descuenta. Se valida el stock resultante de **todos** los productos afectados antes de guardar **cualquier** cambio; si alguno quedaría negativo, se rechaza la corrección completa nombrando el producto (`{"stock": "Stock insuficiente para {nombre}. Disponible: {stock}"}`) y no se modifica ni la venta ni el inventario. Reenviar exactamente la misma corrección calcula una diferencia de `0` y es inofensivo (no duplica movimientos de stock).
- **Atomicidad/concurrencia**: toda la operación corre en una única `transaction.atomic`, con el mismo bloqueo transaccional usado por el resto de escrituras y bloqueo de filas de los productos afectados en orden determinístico (por `id`), para que una corrección y una venta/compra simultáneas sobre el mismo producto nunca dejen el stock en negativo.
- **Trazabilidad (RF-51/RNF-06)**: la venta conserva su `id`; se agregan `corregida` (booleano), `corregidaPor` (usuario que corrigió, se muestra su nombre de usuario) y `corregidaEn` (fecha/hora de la última corrección). No se guarda un historial de versiones: cada corrección sobrescribe esos tres campos con el estado más reciente. Aparecen en el listado, detalle, factura e historial de ventas, que muestra una insignia "Corregida" junto al estado; una venta sin corregir se ve exactamente igual que antes.
- **Reembolsos**: `ensure_sale_has_no_refunds(venta)` en `facturacion/services.py` ahora rechaza la corrección con 409 si la venta ya tiene al menos un reembolso (ver [Reembolsos](#reembolsos)). El orden solo puede ser corregir **primero** y reembolsar después; una vez reembolsada (parcial o totalmente), la venta ya no se puede corregir.

En el frontend, el botón "Corregir" solo lo ve un administrador (es UX; el backend igual exige el rol) desde el historial de ventas y desde la pantalla de confirmación de pago. Si la venta ya tiene reembolsos, el botón se muestra deshabilitado con un título explicando por qué, en vez de desaparecer. Entrar en modo corrección usa un estado propio y separado del ticket de venta en curso, así que no destruye una venta nueva que el administrador estuviera armando en ese momento.

## Reembolsos

Reembolso parcial o total de una venta `cerrada` (RF-60/61/62/64/65). Es un **endpoint y un servicio aparte** (`create_refund` en `facturacion/services.py`), anidado bajo la venta: un reembolso no reemplaza la venta ni cambia sus ítems/totales originales, solo agrega un documento asociado — mezclarlo con el endpoint de ventas hubiera significado simular una "actualización" de venta que en realidad nunca cambia nada de la venta.

`POST /api/ventas/{uuid}/reembolsos/` — solo administrador (cajero recibe 403; fila `reembolsos` en `facturacion.accounts.PERMISSIONS`). Si la venta no está cerrada, devuelve 400.

Body, modo **parcial** (por producto y cantidad):

```json
{"id": "<uuid generado por el cliente>", "itemsJson": "[{\"productoId\": \"...\", \"cantidad\": 1, \"retornaInventario\": true}]"}
```

Body, modo **total** (reembolsa TODO lo que aún quede pendiente de la venta): `itemsJson` debe venir **vacío**; `itemsJson` no vacío junto con `total` es una contradicción y se rechaza con 400.

```json
{"id": "<uuid generado por el cliente>", "total": true, "itemsJson": "[]"}
```

- **`id` lo genera el cliente** (igual que venta/compra/corrección) para reintentos idempotentes: reenviar la misma solicitud con el mismo `id` devuelve el reembolso ya creado (200, en vez de 201) sin duplicar monto ni stock. Reenviar el mismo `id` con datos distintos se rechaza con 409.
- **Validaciones**: solo ventas cerradas; cantidad entera positiva; `cantidad <= vendida - ya reembolsada` por línea (cuenta los reembolsos previos de esa línea); al menos una línea en modo parcial; sin productos repetidos en la misma solicitud; un reembolso "total" sin nada pendiente se rechaza con 400. Todo se valida bajo el mismo bloqueo transaccional que el resto de escrituras, con `select_for_update` de las líneas de la venta y de los productos afectados (en orden determinístico), para que dos reembolsos simultáneos sobre la misma línea nunca superen lo vendido.
- **Monto (RF-62)**: lo calcula siempre el servidor, proporcional al descuento de la venta: `precio_unitario_de_la_línea × cantidad × (total / subtotal)`. Para que la suma de **todos** los reembolsos de una venta reembolsada por completo sea **exactamente** el total (sin perder ni sobrar nada por el redondeo hacia abajo), el monto de cada línea es la *diferencia* entre el redondeo del subtotal-ya-reembolsado-de-toda-la-venta **después** de sumarla y **antes**, procesando las líneas en un orden fijo (por id). Protege `subtotal == 0` (monto siempre `0` en ese caso).
- **Inventario (RN-05/3.9)**: por línea, si `retornaInventario` es `true` y el producto tiene `seguimientoInventario`, `stock += cantidad`; si es `false`, o el producto no sigue inventario, el stock no cambia. `retornaInventario` es explícito por línea en el body (no hay un valor implícito).
- **Trazabilidad (RNF-06)**: cada reembolso guarda usuario y fecha. La venta (listado, detalle, factura, para **todos** los roles) incluye `estadoReembolso` (`"ninguno"`/`"parcial"`/`"total"`, calculado por **cantidad** reembolsada de cada línea, no por monto, para que una venta de $0 con 100% de descuento también pueda marcarse como reembolsada), `totalReembolsado` y `reembolsos` (lista con fecha, usuario, líneas —producto, cantidad, si retornó inventario— y monto). El total original de la venta nunca cambia; el neto se calcula como `total - totalReembolsado`.
- **Corrección**: una vez que una venta tiene al menos un reembolso, ya no se puede corregir (ver [arriba](#corrección-de-ventas-cerradas)); las rutas normales `PUT`/`PATCH`/`DELETE` de la venta siguen bloqueadas como siempre.
- **Fuera de alcance de esta fase** (deliberado, no implementado): origen/caja de donde sale el dinero del reembolso, destino "pérdida" de inventario para lo que no retorna, saldo del cliente por pagos `Debe`, y anulación o eliminación de ventas.

En el frontend, el botón "Reembolsar" solo lo ve un administrador, desde el detalle de una venta cerrada en el historial (se oculta cuando ya no queda nada pendiente, es decir cuando `estadoReembolso` es `"total"`). Abre un modal con una tabla por línea (vendido / ya reembolsado / disponible / cantidad a reembolsar / si retorna al inventario), un botón "Reembolsar todo" que solo llena las cantidades hasta lo disponible, una vista previa informativa del monto (replica la misma fórmula del backend, que es quien manda al confirmar) y un paso de confirmación explícito antes de enviar. El `id` del reembolso se genera al abrir el modal y se reutiliza en reintentos de ese mismo envío (si falla, no se pierde la selección). **Decisión deliberada**: el frontend nunca usa el modo `total` de la API — como ya tiene cargado cuánto queda pendiente de cada línea, "Reembolsar todo" simplemente llena esas cantidades en modo parcial explícito (así cada línea conserva su propio casillero de "retorna al inventario"); el modo `total` queda disponible para otros clientes de la API (cubierto por Postman y por `facturacion/tests.py`) pero la UI no lo necesita.

## SQL independiente

La opción recomendada es `py run.py`, que usa migraciones. Para cargar los archivos manualmente en una **base vacía** de PostgreSQL 18:

```powershell
psql -h 127.0.0.1 -U postgres -d papel_y_luna -v ON_ERROR_STOP=1 -f sql/schema.sql
psql -h 127.0.0.1 -U postgres -d papel_y_luna -v ON_ERROR_STOP=1 -1 -f sql/seed.sql
psql -h 127.0.0.1 -U postgres -d papel_y_luna -v ON_ERROR_STOP=1 -1 -f sql/usuarios_iniciales.sql
.venv/Scripts/python.exe manage.py migrate --fake
py run.py --no-seed
```

También puedes ejecutarlos desde Query Tool en pgAdmin. `schema.sql` incluye su propia transacción. No ejecutarlo en una base ya migrada. `schema.sql` ya incluye las tres migraciones (`0001_initial`, `0002_auth` y `0003_descuentos`); como solo la primera es "inicial", `run.py`/`--fake-initial` no detecta solas las demás, por eso el paso manual usa `migrate --fake` (marca las tres como aplicadas sin volver a ejecutarlas) antes de `run.py --no-seed` (los datos y usuarios ya quedaron cargados por los SQL anteriores). `seed_history` evita que el arranque vuelva a insertar ejemplos que hayas eliminado. `seed.sql`/`usuarios_iniciales.sql` pueden ejecutarse varias veces sin actualizar filas existentes; para no restaurar ejemplos eliminados usa los comandos protegidos `manage.py seed`.

Para regenerar el esquema desde las migraciones:

```powershell
.venv/Scripts/python.exe manage.py sqlmigrate facturacion 0001 | Out-File sql/schema.sql -Encoding utf8
.venv/Scripts/python.exe manage.py sqlmigrate facturacion 0002 | Out-File sql/schema.sql -Encoding utf8 -Append
.venv/Scripts/python.exe manage.py sqlmigrate facturacion 0003 | Out-File sql/schema.sql -Encoding utf8 -Append
.venv/Scripts/python.exe manage.py sqlmigrate facturacion 0004 | Out-File sql/schema.sql -Encoding utf8 -Append
.venv/Scripts/python.exe manage.py sqlmigrate facturacion 0005 | Out-File sql/schema.sql -Encoding utf8 -Append
```

## Demostración y pruebas

Importa `postman/actividad_10.postman_collection.json` en Postman. Define `baseUrl=http://127.0.0.1:8000` y ejecuta la colección en orden: la primera solicitud inicia sesión como `admin` y guarda el token en la variable de colección `token`, que las demás reutilizan. Crea sus propias categorías/productos y documentos de demostración: usa una base de pruebas.

```powershell
postman collection run postman/actividad_10.postman_collection.json --env-var baseUrl=http://127.0.0.1:8000
.venv/Scripts/python.exe manage.py test facturacion --noinput
node --test tests/mvp2.test.cjs
```

Las pruebas Django (98) crean y destruyen una base `test_<DB_NAME>`: el usuario debe poder crear bases. Cubren CRUD, validadores, ambos middlewares, protección de archivos privados, reintentos, rollback, compras simultáneas, login/logout, tokens vencidos o inválidos, la matriz de permisos por rol (parametrizada sobre `accounts.PERMISSIONS`), el catálogo de descuentos (validación, permisos, cálculo porcentual/fijo, rechazo del fijo mayor al subtotal, idempotencia y que editar/eliminar un descuento no altere ventas ya registradas), la corrección de ventas cerradas (permisos, diferencias de inventario, precio/costo congelado, descuento congelado, trazabilidad, concurrencia) y los reembolsos (permisos, parcial/total, monto proporcional sin deriva de redondeo, inventario según `retornaInventario`, idempotencia, concurrencia, rollback atómico y el bloqueo de corrección tras reembolsar). Las pruebas JavaScript (21) conservan la cobertura del store y del backend histórico simulado, agregan la fórmula de descuento, la lógica del ticket (aplicar/reemplazar/quitar, bloqueo cuando el fijo supera el subtotal), el modo corrección, el alta rápida de cliente y la lógica de reembolsos (vista previa, "Reembolsar todo", cantidades acotadas, generación/reuso del UUID); la integración con el backend nuevo se verifica adicionalmente contra HTTP real (inicia sesión primero con el usuario sembrado por `manage.py seed`):

```powershell
$env:TEST_API_URL='http://127.0.0.1:8000'
# Opcionales si sobrescribiste las credenciales de seed: TEST_ADMIN_USER / TEST_ADMIN_PASSWORD
node tests/django-integration.cjs
```

Este último comando también crea documentos; dirigirlo a una base de pruebas. `tests/browser.cjs` conduce la interfaz real con Playwright contra su propio servidor simulado (no Django): ese mock responde cualquier `/api/auth/login/` como administrador (la autenticación real ya la cubren las pruebas Django de arriba), así que el script primero completa el formulario de login y luego continúa el recorrido de siempre.

```powershell
npm.cmd install --no-save --package-lock=false --prefix .tmp-tools playwright
$env:NODE_PATH = Join-Path (Get-Location) '.tmp-tools/node_modules'
node tests/browser.cjs
```

Requiere Edge instalado; las capturas quedan en `.tmp-tools` y no se incluyen en la entrega. La guía de exposición y repaso conceptual está en `docs/actividad_10.md`; la evidencia de validación, en `docs/verificacion.md`.

Para generar el ZIP entregable (sin `.env`, `.venv`, cachés ni bases):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

`apps-script.gs` y `docs/legacy_apps_script.md` se conservan como referencia de la versión anterior; el frontend actual utiliza exclusivamente Django. Esta adaptación no importa automáticamente los datos históricos de Google Sheets.

## Despliegue

Backend (Django + PostgreSQL) y frontend (estático) van en plataformas distintas; se comunican por HTTP con CORS, no por sesión de Django ni cookies.

### Variables de entorno

| Variable | Para qué sirve | Ejemplo (sin secretos reales) |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Clave secreta de Django. **Obligatoria** si `DJANGO_DEBUG` no es `true`; si falta, el backend no arranca. | `k7x...` (genera una propia, no la publiques) |
| `DJANGO_DEBUG` | Activa trazas y detalles de error. `false` en todo despliegue real. | `false` |
| `DJANGO_ALLOWED_HOSTS` | Hosts permitidos, separados por coma. | `tu-backend.onrender.com` |
| `DATABASE_URL` | Cadena de conexión Postgres, si tu proveedor la arma por ti. Si no está definida, se usan `DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_HOST`/`DB_PORT` igual que en local. | `postgres://usuario:clave@host:5432/basededatos` |
| `DB_SSLMODE` | `sslmode` de la conexión, si el proveedor lo exige y no viene incluido en `DATABASE_URL`. | `require` |
| `CORS_ALLOWED_ORIGINS` | Orígenes del frontend con permiso de llamar a la API, separados por coma. | `https://papel-y-luna.vercel.app` |
| `SESSION_TTL_HOURS` | Horas de vigencia del token (ver [Autenticación y roles](#autenticación-y-roles)). | `12` |
| `SEED_ADMIN_USER` / `SEED_ADMIN_PASSWORD` | Credenciales del administrador que siembra `manage.py seed`. | `admin` / *(contraseña propia)* |
| `SEED_CAJERO_USER` / `SEED_CAJERO_PASSWORD` | Credenciales del cajero sembrado. | `cajero` / *(contraseña propia)* |
| `PORT` | Puerto en el que escucha `gunicorn`; normalmente lo fija la plataforma. | `10000` |

### Backend en Render (con base de datos)

**Opción A — Blueprint:** en Render, *New → Blueprint*, apunta al repositorio (usa `render.yaml`): crea la base de datos Postgres y el servicio web, genera `DJANGO_SECRET_KEY` solo, y conecta `DATABASE_URL` automáticamente. Completa en el dashboard las variables marcadas como manuales (`CORS_ALLOWED_ORIGINS`, `SEED_ADMIN_PASSWORD`, etc. — no están en el archivo).

**Opción B — manual:** *New → PostgreSQL* (anota su "Internal/External Database URL"), luego *New → Web Service* apuntando al repo, con *Build Command* `pip install -r requirements.txt` y *Start Command* la del `Procfile` (migra, siembra usuarios una sola vez y recién ahí arranca `gunicorn`). Agrega las variables de la tabla anterior.

Cualquier otra plataforma equivalente (Railway, Fly) sirve igual: instala `requirements.txt`, define las mismas variables y ejecuta el *Start Command* del `Procfile`.

### Frontend en un host estático

1. Antes de subir, cambia **una sola línea** en `js/config.js`: `apiBaseUrl` pasa de `"/api/"` a la URL absoluta del backend, por ejemplo `"https://tu-backend.onrender.com/api/"`. Nada más del código cambia.
2. Sube `index.html`, `js/`, `css/` y `assets/` a Vercel, Netlify o GitHub Pages. No hace falta build ni reglas de redirección: la navegación es por fragmento de URL (`#venta`, `#historial`, ...), que cualquier host estático sirve igual sin configuración extra — por eso no se agregó un `_redirects`/`vercel.json`.
3. Agrega esa URL del frontend a `CORS_ALLOWED_ORIGINS` en el backend.

### CORS y CSRF

`django-cors-headers` lee `CORS_ALLOWED_ORIGINS` y permite el encabezado `Authorization` (viene en su lista por defecto). No hace falta configurar CSRF ni cookies: la API se autentica solo con el token `Authorization: Bearer <token>` (ver [Autenticación y roles](#autenticación-y-roles)); Django ni siquiera tiene `CsrfViewMiddleware` en `MIDDLEWARE`, así que esas verificaciones no se ejecutan para `/api/`.

### Verificación local simulando producción

Se probó con `DJANGO_DEBUG=false`, `DATABASE_URL` apuntando a una base Postgres local, `DJANGO_SECRET_KEY` explícita y el frontend servido desde un puerto distinto al del backend (origen distinto, como en el despliegue real), sin tocar `js/config.js` del repositorio (se probó sobre una copia aparte):

- Sin `DJANGO_SECRET_KEY` y con `DJANGO_DEBUG=false`, el backend se niega a arrancar con un mensaje claro (no genera una clave efímera).
- `manage.py migrate` + `manage.py seed` corridos dos veces: la segunda vez no repite migraciones ni duplica usuarios/datos de ejemplo.
- `DATABASE_URL` con contraseña con caracteres especiales (`%40` → `@`) y `?sslmode=require` se interpreta correctamente.
- Preflight CORS (`OPTIONS`) desde `http://127.0.0.1:9100` contra el backend en `http://127.0.0.1:9000` responde `access-control-allow-origin` con ese origen.
- Login y carga de datos funcionando con el frontend en un puerto y el backend en otro (equivalente a dominios distintos).

**Limitación conocida:** `gunicorn` no corre en Windows (depende de `fcntl`, módulo que no existe ahí), así que esta verificación local usó `manage.py runserver` como reemplazo del servidor WSGI. El `Procfile`/`render.yaml` sí usan `gunicorn`, que es el estándar en Linux (donde corren Render/Railway/Fly); no se pudo probar `gunicorn` en sí desde esta máquina.

Referencias técnicas: [Django y PostgreSQL](https://docs.djangoproject.com/en/5.2/ref/databases/), [middlewares de Django](https://docs.djangoproject.com/en/5.2/topics/http/middleware/) y [CREATE DATABASE en PostgreSQL 18](https://www.postgresql.org/docs/18/sql-createdatabase.html).
