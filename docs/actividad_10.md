# Actividad 10: demostración y repaso

Los ejemplos del documento de clase sobre personajes se adaptan a productos, contactos y documentos de facturación. Se usaron Serializers de Django REST Framework, una de las alternativas de validación permitidas por la guía.

## Demostración práctica

1. Ejecutar `py run.py` y abrir el frontend. Mostrar productos de ejemplo, guardar una venta abierta, retomarla, cobrarla y registrar una compra.
2. En Postman hacer `GET /api/productos/`. Consultar en pgAdmin:

   ```sql
   SELECT id, method, path, ip, called_at
   FROM request_log ORDER BY id DESC LIMIT 20;
   ```

   La nueva llamada aparece porque el middleware persiste el log antes del controlador. También se puede usar `GET /api/request-logs/`.
3. Enviar `POST /api/clientes/` con `{}` o `{"nombre":123}`: devuelve 400 con error por campo. Mostrar `facturacion/validators.py` y que el controlador no contiene validaciones manuales del body.
4. Hacer un PUT inválido al producto de la colección, por ejemplo `precio: true`; mostrar 400. El mismo PUT con datos válidos devuelve 200.
5. Hacer `GET /api/demo/sanitizacion/`. Mostrar el objeto original en `controllers/diagnostics.py` y comprobar que no llegan `cliente_id`, `proveedor_id` ni `producto_id`; sobreviven `id`, `nombre`, `cantidad` y `productoId`.
6. En el CRUD de clientes de la colección mostrar POST, PUT, GET y DELETE. Consultar de nuevo `request_log` para comprobar que registra todos los métodos, incluso solicitudes rechazadas.
7. Mostrar la venta abierta sin descuento de stock, el cierre con descuento y el reintento con el mismo UUID sin descuento adicional. Una compra vuelve a sumar unidades. Una venta cerrada no se puede eliminar (409).

Las 27 solicitudes de la colección están numeradas para ejecutar esta demostración. Los documentos contabilizados permanecen por integridad: usar una base de demostración independiente.

## Responsabilidades

| Componente | Pregunta que resuelve | Ejemplo |
| --- | --- | --- |
| Modelo | ¿Cómo se almacena y relaciona la información? | Producto pertenece a categoría |
| Controller / view | ¿Cómo entra y sale HTTP? | POST devuelve 201 con JSON |
| Validator | ¿La entrada tiene estructura y valores válidos? | Precio debe ser entero no negativo |
| Servicio | ¿Qué permite el negocio y qué cambia? | Cerrar descuenta stock de forma atómica |
| Middleware pre | ¿Qué ocurre antes del controlador para todas las llamadas? | Guardar método, ruta, IP y fecha |
| Middleware post | ¿Qué se aplica a la respuesta antes de enviarla? | Quitar claves terminadas en `_id` |

Los middlewares son transversales; no sustituyen las capas de modelo, controlador o servicio. Los validators se reutilizan entre POST, PUT y PATCH. Validar en el navegador ayuda a la experiencia de uso, pero el servidor vuelve a validar porque un cliente como Postman puede omitir el frontend.

## Preguntas de repaso

1. ¿Dónde se representan las entidades y relaciones? **En los modelos**.
2. ¿Qué responsabilidad tiene un controlador? **Recibir HTTP, delegar trabajo y devolver una respuesta**.
3. ¿Por qué separar validators? **Para centralizar reglas de entrada, reutilizarlas y mantener controladores pequeños**.
4. ¿Cuándo actúa un pre-filter? **Antes de llamar al controlador**.
5. ¿Cuándo actúa un post-filter? **Después del controlador y antes de enviar la respuesta al cliente**.
6. ¿Qué hace el middleware de logging? **Registra la llamada; no calcula totales ni cambia inventario**.
7. ¿Qué significa el orden de MIDDLEWARE? **Request baja por la lista y response regresa en sentido inverso**.
8. ¿Qué devuelve una entrada inválida? **400 con detalles claros por campo**.
9. ¿Por qué usar una transacción al vender? **Para que documento, detalle e inventario se confirmen juntos o se reviertan juntos**.
10. ¿Sanitizar `_id` elimina también `id`? **No; sólo elimina claves que terminen exactamente en `_id`, recursivamente en objetos y listas JSON**.
