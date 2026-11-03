import uuid
from django.db import models
from django.db.models.functions import Lower


class Identified(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True


class Categoria(Identified):
    nombre = models.CharField(max_length=120)

    class Meta:
        db_table = 'categorias'
        constraints = [models.UniqueConstraint(Lower('nombre'), name='categoria_nombre_unico')]


class Contacto(Identified):
    nombre = models.CharField(max_length=150)
    telefono = models.CharField(max_length=40, blank=True)
    correo = models.EmailField(blank=True)

    class Meta:
        abstract = True


class Cliente(Contacto):
    class Meta:
        db_table = 'clientes'


class Proveedor(Contacto):
    class Meta:
        db_table = 'proveedores'


class Producto(Identified):
    codigo = models.CharField(max_length=60)
    nombre = models.CharField(max_length=150)
    categoria = models.ForeignKey(Categoria, on_delete=models.PROTECT)
    precio = models.PositiveIntegerField()
    costo = models.PositiveIntegerField()
    seguimiento_inventario = models.BooleanField(default=True)
    stock = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = 'productos'
        constraints = [
            models.UniqueConstraint(Lower('codigo'), name='producto_codigo_unico'),
            models.CheckConstraint(condition=models.Q(seguimiento_inventario=True) | models.Q(stock=0), name='stock_sin_seguimiento_cero'),
        ]


class Venta(Identified):
    fecha = models.DateTimeField()
    estado = models.CharField(max_length=10, choices=[('abierta', 'Abierta'), ('cerrada', 'Cerrada')])
    cliente = models.ForeignKey(Cliente, null=True, blank=True, on_delete=models.PROTECT)
    metodo_pago = models.CharField(max_length=10, choices=[(v, v) for v in ('Efectivo', 'Nequi', 'Debe')])
    subtotal = models.PositiveBigIntegerField(default=0)
    total = models.PositiveBigIntegerField(default=0)
    valor_recibido = models.PositiveBigIntegerField(default=0)
    cambio = models.PositiveBigIntegerField(default=0)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'ventas'
        constraints = [
            models.CheckConstraint(condition=models.Q(estado__in=['abierta', 'cerrada']), name='venta_estado_valido'),
            models.CheckConstraint(condition=models.Q(metodo_pago__in=['Efectivo', 'Nequi', 'Debe']), name='venta_pago_valido'),
            models.CheckConstraint(condition=~models.Q(estado='cerrada', metodo_pago='Debe') | models.Q(cliente__isnull=False), name='venta_credito_cliente'),
            models.CheckConstraint(condition=~models.Q(estado='cerrada', metodo_pago='Efectivo') | models.Q(valor_recibido__gte=models.F('total')), name='venta_efectivo_suficiente'),
        ]


class Compra(Identified):
    fecha = models.DateField()
    proveedor = models.ForeignKey(Proveedor, on_delete=models.PROTECT)
    total = models.PositiveBigIntegerField(default=0)

    class Meta:
        db_table = 'compras'


class Linea(models.Model):
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT)
    codigo = models.CharField(max_length=60)
    nombre = models.CharField(max_length=150)
    precio = models.PositiveIntegerField(default=0)
    costo = models.PositiveIntegerField()
    cantidad = models.PositiveIntegerField()

    class Meta:
        abstract = True


class DetalleVenta(Linea):
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name='items')

    class Meta:
        db_table = 'detalle_ventas'
        constraints = [models.UniqueConstraint(fields=['venta', 'producto'], name='venta_producto_unico'),
                       models.CheckConstraint(condition=models.Q(cantidad__gt=0), name='venta_cantidad_positiva')]


class DetalleCompra(Linea):
    compra = models.ForeignKey(Compra, on_delete=models.CASCADE, related_name='items')

    class Meta:
        db_table = 'detalle_compras'
        constraints = [models.UniqueConstraint(fields=['compra', 'producto'], name='compra_producto_unico'),
                       models.CheckConstraint(condition=models.Q(cantidad__gt=0), name='compra_cantidad_positiva')]


class RequestLog(models.Model):
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=255)
    ip = models.GenericIPAddressField(null=True)
    called_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'request_log'


class SeedHistory(models.Model):
    version = models.CharField(primary_key=True, max_length=80)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'seed_history'
