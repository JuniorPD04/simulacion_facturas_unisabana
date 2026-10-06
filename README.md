# POS Papel y Luna - MVP 2

Aplicacion de curso en HTML, CSS y JavaScript vanilla. Los datos del sistema se
guardan en Google Sheets mediante Google Apps Script. No requiere compilacion ni
dependencias para funcionar.

Integrantes: Junior Perez Davila, Claudia Libertad Quispe Terrones y Samuel Andres
Zona Malaver.

## Configuracion obligatoria antes de entregar

La URL del servicio esta vacia en `js/api.js`. El proyecto mostrara un error de
conexion hasta completar estos pasos con la cuenta Google del equipo.

1. Crear una hoja de calculo en Google Sheets.
2. Abrir **Extensiones > Apps Script** desde esa hoja.
3. Reemplazar el contenido de `Code.gs` por el archivo `apps-script.gs`.
4. Guardar y ejecutar `prepararHojas` desde el editor. Autorizar el acceso.
   La funcion crea las seis pestanas y registra el ID de la hoja en las
   propiedades del script. No modifica encabezados existentes incorrectos:
   los informa para que se corrijan.
5. Elegir **Implementar > Nueva implementacion > Aplicacion web**.
   Ejecutar como el propietario y permitir acceso a **Cualquier persona**.
6. En `js/api.js`, establecer `API_URL` con la URL publicada que termina en
   `/exec`. No usar la URL del documento de Sheets ni la URL de prueba `/dev`.
7. Abrir esa URL con `?resource=productos` en una ventana privada. Debe mostrar
   `{"success":true,"data":[]}` si la hoja esta vacia, sin solicitar iniciar sesion.
8. Abrir `index.html`, crear primero categorias, clientes y proveedores; luego
   productos. Tambien se puede importar la informacion de MVP1 como se indica
   mas abajo. Los datos de demostracion se crean en Sheets, no en el codigo.

Al modificar el Apps Script, publicar una **nueva version** desde
**Implementar > Gestionar implementaciones > Editar**.

La configuracion de publicacion y el seguimiento de redirecciones se apoyan en
la documentacion oficial de Google:
[aplicaciones web](https://developers.google.com/apps-script/guides/web),
[Content Service](https://developers.google.com/apps-script/guides/content).
El ID se guarda durante la preparacion porque
[los metodos del documento activo no estan disponibles en aplicaciones web](https://developers.google.com/apps-script/guides/bound).

## Pestanas y encabezados

Cada columna debe estar en el orden indicado, en la fila 1. Los nombres son
sensibles a mayusculas. `prepararHojas` crea esta estructura automaticamente.

| Pestana | Encabezados |
| --- | --- |
| productos | id, codigo, nombre, categoriaId, precio, costo, seguimientoInventario, stock |
| categorias | id, nombre |
| clientes | id, nombre, telefono, correo |
| proveedores | id, nombre, telefono, correo |
| ventas | id, fecha, estado, clienteId, metodoPago, subtotal, total, valorRecibido, cambio, itemsJson, actualizadoEn |
| compras | id, fecha, proveedorId, total, itemsJson |

`seguimientoInventario` es booleano. Stock y cantidades son enteros no
negativos; la cantidad de un item debe ser mayor que cero. Precio y costo deben
ser numeros no negativos. `itemsJson` contiene un arreglo serializado:

```js
// Venta
{ productoId, codigo, nombre, precio, costo, cantidad }
// Compra
{ productoId, codigo, nombre, cantidad, costo }
```

IDs generados mediante `crypto.randomUUID()`. En despliegue usar HTTPS; para
desarrollo con servidor usar localhost. Fechas de venta en ISO y fecha de compra
seleccionada por el usuario.

## Servicio y consistencia

`js/api.js` concentra el acceso al servicio:

```js
await PYL.api.apiGet("productos");
await PYL.api.apiPost("clientes", "create", {
  id: crypto.randomUUID(), nombre: "Nombre", telefono: "", correo: ""
});
await PYL.api.apiPost("clientes", "update", { id, telefono: "3001234567" });
await PYL.api.apiPost("clientes", "delete", { id });
```

GET usa `?resource=...`. POST envia `{action,data}` como JSON con
`Content-Type: text/plain;charset=utf-8` para evitar preflight de Apps Script.
Las respuestas son `{success:true,data}` o `{success:false,message}`.
`update` conserva los campos omitidos; `delete` devuelve `{id}`.
Se validan recursos, acciones, IDs, campos, cantidades, pagos y referencias en
el servicio.

Ventas abiertas se guardan en Sheets y pueden retomarse desde Ventas. Retomar
una venta conserva su registro y guarda primero otro ticket en curso, si tiene
productos. Limpiar un ticket no elimina la version guardada; descartar una venta
abierta en Ventas si elimina ese registro. El cierre requiere productos, stock
suficiente, efectivo que cubra el total o cliente asociado para Debe.

Al editar un producto desde el catalogo de venta cambian nombre, categoria,
precio y costo; tambien se actualiza el ticket actual. El stock y el codigo se
editan desde Productos. Las ventas cerradas conservan los valores de sus items.
Las categorias, clientes y proveedores asociados no se pueden eliminar; tampoco
productos presentes en ventas abiertas. Productos que solo aparecen en documentos
cerrados se pueden eliminar porque sus items contienen una instantanea.

**Inventario:** Apps Script ejecuta el registro y sus movimientos dentro de un
bloqueo del script, valida el stock actual, guarda primero el documento y despues
actualiza productos. El navegador actualiza su estado solo tras la confirmacion
del servicio y vuelve a consultar productos. Esto evita una secuencia de POST
separados desde el cliente. Guardar una venta abierta no descuenta stock. La
compra suma stock y actualiza costo; en productos sin seguimiento solo actualiza
el costo. Repetir un documento identico con el mismo ID devuelve el registro
existente sin repetir movimientos.

Si una escritura falla, el servicio intenta restaurar las filas originales.
Sheets no ofrece transacciones: una interrupcion abrupta de la ejecucion o un
fallo durante la restauracion puede requerir revision manual del documento y
del inventario. El bloqueo coordina peticiones del script, no ediciones manuales
de la hoja. No modificar stock en Sheets durante una operacion. Si se pierde
la respuesta, usar Actualizar datos y comprobar el historial antes de reintentar.
Si solo falla la recarga del inventario despues de un registro exitoso, se
informa que el documento ya fue registrado y se exige actualizar antes del
siguiente cierre o compra.

## Migracion opcional desde MVP1

La migracion es una operacion unica sobre una hoja vacia. No se ejecuta al abrir
la app. Exportar desde el navegador donde se utilizo MVP1, antes de perder ese
almacenamiento, usando su consola:

```js
copy(localStorage.getItem("papel-y-luna-pos-mvp1"))
```

`copy` es una utilidad de la consola de Chrome/Edge. Conservar ese JSON como
respaldo. En el editor de Apps Script agregar temporalmente una funcion:

```js
function importarRespaldo() {
  var datos = /* pegar aqui el objeto JSON exportado */;
  Logger.log(migrarMVP1(datos));
}
```

Reemplazar el comentario por el objeto completo y ejecutar `importarRespaldo`.
La funcion crea categorias desde los textos existentes, convierte `categoria`
en `categoriaId`, crea clientes desde nombres, convierte borradores en ventas
abiertas, migra el ticket pendiente y transforma los nombres de campos de items.
El stock importado ya incluye ventas cerradas, por lo que no se descuenta otra
vez. Luego retirar la funcion temporal y publicar la version del servicio.
Si la importacion se interrumpe, restaurar el respaldo en una hoja vacia nueva
antes de volver a ejecutar; el importador rechaza hojas con registros.

## Ejecucion y despliegue

Abrir `index.html` directamente; todas las rutas y recursos son relativos.
Tambien se puede usar Live Server. La factura se imprime desde
**Imprimir / PDF**; elegir Guardar como PDF en el dialogo del navegador.

Para GitHub Pages:

1. Configurar y comprobar primero el servicio publicado.
2. Subir `index.html`, `js/`, `css/` y `assets/` al repositorio.
3. En **Settings > Pages**, elegir despliegue desde una rama, la rama del
   proyecto y la carpeta raiz.
4. Abrir la URL HTTPS publicada y comprobar ventas y compras desde alli.

## Verificacion

Pruebas de logica sin dependencias, con Node.js:

```powershell
node --test tests/mvp2.test.cjs
```

Pruebas de navegador con Edge instalado:

```powershell
npm.cmd install --no-save --package-lock=false --prefix .tmp-tools playwright
$env:NODE_PATH = Join-Path (Get-Location) '.tmp-tools/node_modules'
node tests/browser.cjs
```

Las pruebas usan una hoja simulada y ejecutan el Apps Script real. Las de
navegador sustituyen la URL solo en su servidor temporal y comprueban el flujo
completo y anchos 1440, 768, 390 y 320. Las capturas y dependencias de prueba quedan
en `.tmp-tools` y no se incluyen en la entrega. Estas pruebas no sustituyen
la comprobacion del despliegue real de Google.

Antes de entregar, verificar con el Google Sheet publicado: carga vacia, CRUD
de entidades/productos, bloqueos de eliminacion, venta abierta y reanudacion,
pago Debe, efectivo y cambio, stock insuficiente, compra y costo, factura y
persistencia al recargar. Comprobar GET, create, update parcial, delete e ID
inexistente en el servicio.

## Entrega

Formato del aula: **perez-quispe-zona-mvp2-web-2026-2.zip**.
Generar o actualizar el ZIP despues de configurar `API_URL`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

El empaquetador usa una lista de archivos e incluye codigo, assets, README,
Apps Script y pruebas. Excluye .git, node_modules, herramientas temporales,
ZIP anteriores y archivos ajenos. No hay compilacion.

Alcance implementado: ventas, productos, historial/facturas, compras, categorias,
clientes, proveedores y control de inventario. Los modulos de la entrega final
(autenticacion, descuentos, reembolsos y reportes) quedan fuera de este MVP.
