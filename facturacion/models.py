import uuid
from django.contrib.auth.hashers import check_password, make_password
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


DESCUENTO_TIPOS = ('porcentual', 'fijo')


class Descuento(Identified):
    """Catálogo reutilizable (RF-112). Se puede eliminar aunque ya se haya
    usado en ventas (3.9): Venta guarda su propia copia (ver más abajo), y el
    FK de Venta a este modelo es SET_NULL, así que borrar un descuento nunca
    bloquea ni altera las ventas que ya lo aplicaron."""
    nombre = models.CharField(max_length=120)
    tipo = models.CharField(max_length=20, choices=[(t, t) for t in DESCUENTO_TIPOS])
    valor = models.PositiveIntegerField()

    class Meta:
        db_table = 'descuentos'
        constraints = [
            models.CheckConstraint(condition=models.Q(tipo__in=list(DESCUENTO_TIPOS)), name='descuento_tipo_valido'),
            models.CheckConstraint(condition=models.Q(valor__gt=0), name='descuento_valor_positivo'),
            models.CheckConstraint(condition=~models.Q(tipo='porcentual') | models.Q(valor__lte=100), name='descuento_porcentual_max_100'),
        ]


class Venta(Identified):
    fecha = models.DateTimeField()
    estado = models.CharField(max_length=10, choices=[('abierta', 'Abierta'), ('cerrada', 'Cerrada')])
    cliente = models.ForeignKey(Cliente, null=True, blank=True, on_delete=models.PROTECT)
    metodo_pago = models.CharField(max_length=10, choices=[(v, v) for v in ('Efectivo', 'Nequi', 'Debe')])
    subtotal = models.PositiveBigIntegerField(default=0)
    # Copia del descuento aplicado al momento de guardar (RN-08/3.9): editar o
    # eliminar el descuento del catálogo no debe cambiar ventas existentes.
    # El FK es solo trazabilidad/edición mientras la venta sigue abierta.
    descuento = models.ForeignKey(Descuento, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    descuento_nombre = models.CharField(max_length=120, blank=True, default='')
    descuento_tipo = models.CharField(max_length=20, blank=True, default='')
    descuento_valor = models.PositiveIntegerField(null=True, blank=True)
    descuento_monto = models.PositiveBigIntegerField(default=0)
    total = models.PositiveBigIntegerField(default=0)
    valor_recibido = models.PositiveBigIntegerField(default=0)
    cambio = models.PositiveBigIntegerField(default=0)
    actualizado_en = models.DateTimeField(auto_now=True)
    # Trazabilidad de correccion (RF-51/RNF-06). No se exige historial de
    # versiones (RN-06): solo se guarda quien/cuando de la ULTIMA correccion.
    corregida = models.BooleanField(default=False)
    corregida_por = models.ForeignKey('Usuario', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    corregida_por_nombre = models.CharField(max_length=60, blank=True, default='')
    corregida_en = models.DateTimeField(null=True, blank=True)

    @property
    def total_reembolsado(self):
        return sum(r.monto for r in self.reembolsos.all())

    @property
    def estado_reembolso(self):
        """'ninguno'/'parcial'/'total' por CANTIDAD reembolsada de cada linea
        (no por monto): una venta con total $0 (p. ej. 100% de descuento)
        puede devolver todos sus productos sin que eso mueva ningun dinero."""
        lines = list(self.items.all())
        if not lines:
            return 'ninguno'
        refunded_by_line = {line.pk: 0 for line in lines}
        for detalle in DetalleReembolso.objects.filter(linea__venta=self):
            refunded_by_line[detalle.linea_id] = refunded_by_line.get(detalle.linea_id, 0) + detalle.cantidad
        if not any(refunded_by_line.values()):
            return 'ninguno'
        if all(refunded_by_line.get(line.pk, 0) >= line.cantidad for line in lines):
            return 'total'
        return 'parcial'

    class Meta:
        db_table = 'ventas'
        constraints = [
            models.CheckConstraint(condition=models.Q(estado__in=['abierta', 'cerrada']), name='venta_estado_valido'),
            models.CheckConstraint(condition=models.Q(metodo_pago__in=['Efectivo', 'Nequi', 'Debe']), name='venta_pago_valido'),
            models.CheckConstraint(condition=~models.Q(estado='cerrada', metodo_pago='Debe') | models.Q(cliente__isnull=False), name='venta_credito_cliente'),
            models.CheckConstraint(condition=~models.Q(estado='cerrada', metodo_pago='Efectivo') | models.Q(valor_recibido__gte=models.F('total')), name='venta_efectivo_suficiente'),
            models.CheckConstraint(condition=models.Q(descuento_monto__lte=models.F('subtotal')), name='venta_descuento_no_mayor_subtotal'),
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


class Reembolso(Identified):
    """Reembolso de una venta cerrada (3.5/3.9, RF-60..65). El id lo genera el
    cliente (igual que venta/compra) para que reenviar la misma solicitud sea
    idempotente. venta es PROTECT a proposito: nunca se elimina ni se anula una
    venta con reembolsos (fuera de alcance de esta fase)."""
    venta = models.ForeignKey(Venta, on_delete=models.PROTECT, related_name='reembolsos')
    usuario = models.ForeignKey('Usuario', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    usuario_nombre = models.CharField(max_length=60, blank=True, default='')
    fecha = models.DateTimeField(auto_now_add=True)
    monto = models.PositiveBigIntegerField(default=0)
    # Guarda la modalidad pedida (RF-61) para poder reconocer un reenvio
    # identico por id: una vez que "total" ya reembolso todo lo pendiente,
    # lo pendiente pasa a ser 0 y ya no hay como recalcularlo para comparar.
    es_total = models.BooleanField(default=False)

    class Meta:
        db_table = 'reembolsos'


class DetalleReembolso(models.Model):
    """linea apunta al DetalleVenta puntual (no solo al producto) para poder
    acumular cuanto de ESA linea ya se reembolso. PROTECT: una venta con
    reembolsos no se puede corregir (ensure_sale_has_no_refunds), asi que sus
    DetalleVenta nunca se vuelven a borrar/recrear mientras haya un reembolso
    que los referencie."""
    reembolso = models.ForeignKey(Reembolso, on_delete=models.CASCADE, related_name='items')
    linea = models.ForeignKey(DetalleVenta, on_delete=models.PROTECT, related_name='reembolsos')
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT)
    cantidad = models.PositiveIntegerField()
    retorna_inventario = models.BooleanField(default=True)
    monto = models.PositiveBigIntegerField(default=0)

    class Meta:
        db_table = 'detalle_reembolsos'
        constraints = [models.CheckConstraint(condition=models.Q(cantidad__gt=0), name='reembolso_cantidad_positiva')]


FALTANTE_TIPOS = ('agotado', 'no_registrado')
FALTANTE_ESTADOS = ('pendiente', 'resuelto')


class Faltante(Identified):
    """Demanda no atendida (3.7, RF-150..155): no afecta inventario ni ventas
    ni compras (RN-09), es solo informativo para decidir futuras compras."""
    tipo = models.CharField(max_length=20, choices=[(t, t) for t in FALTANTE_TIPOS])
    # SET_NULL (no PROTECT): un faltante informativo no debe impedir eliminar
    # un producto; por eso se guarda tambien una copia de su nombre.
    producto = models.ForeignKey(Producto, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    nombre = models.CharField(max_length=150)
    nombre_normalizado = models.CharField(max_length=150, db_index=True)
    cantidad_solicitada = models.PositiveIntegerField()
    fecha = models.DateTimeField(auto_now_add=True)
    # PROTECT (3.1): no se eliminan proveedores con registros asociados,
    # igual que con las compras.
    proveedor = models.ForeignKey(Proveedor, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    observacion = models.CharField(max_length=300, blank=True, default='')
    estado = models.CharField(max_length=20, choices=[(e, e) for e in FALTANTE_ESTADOS], default='pendiente')
    usuario = models.ForeignKey('Usuario', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    usuario_nombre = models.CharField(max_length=60, blank=True, default='')
    resuelto_en = models.DateTimeField(null=True, blank=True)
    resuelto_por = models.ForeignKey('Usuario', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        db_table = 'faltantes'
        constraints = [
            models.CheckConstraint(condition=models.Q(cantidad_solicitada__gt=0), name='faltante_cantidad_positiva'),
            models.CheckConstraint(condition=models.Q(tipo__in=list(FALTANTE_TIPOS)), name='faltante_tipo_valido'),
            models.CheckConstraint(condition=models.Q(estado__in=list(FALTANTE_ESTADOS)), name='faltante_estado_valido'),
        ]


USUARIO_ROLES = ('administrador', 'cajero')


class Usuario(Identified):
    ROLES = USUARIO_ROLES
    usuario = models.CharField(max_length=60)
    password_hash = models.CharField(max_length=255)
    rol = models.CharField(max_length=20, choices=[(r, r) for r in USUARIO_ROLES])

    class Meta:
        db_table = 'usuarios'
        constraints = [
            models.UniqueConstraint(Lower('usuario'), name='usuario_login_unico'),
            models.CheckConstraint(condition=models.Q(rol__in=list(USUARIO_ROLES)), name='usuario_rol_valido'),
        ]

    # Duck typing mínimo para que rest_framework.permissions.IsAuthenticated
    # funcione sin instalar django.contrib.auth (ver facturacion/accounts.py).
    @property
    def is_authenticated(self):
        return True

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password_hash)


class Sesion(models.Model):
    """Token opaco de sesión; vencimiento controlado por facturacion.accounts."""
    token = models.CharField(max_length=64, primary_key=True)
    usuario = models.ForeignKey(Usuario, on_delete=models.CASCADE, related_name='sesiones')
    creado_en = models.DateTimeField(auto_now_add=True)
    expira_en = models.DateTimeField()

    class Meta:
        db_table = 'sesiones'


class RequestLog(models.Model):
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=255)
    ip = models.GenericIPAddressField(null=True)
    usuario = models.ForeignKey(Usuario, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    called_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'request_log'


class SeedHistory(models.Model):
    version = models.CharField(primary_key=True, max_length=80)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'seed_history'
