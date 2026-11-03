"""Reglas de negocio y transacciones; los controladores no modifican inventario."""
from django.db import connection, transaction
from rest_framework.exceptions import NotFound, ValidationError
from .errors import Conflict
from .models import Categoria, Cliente, Proveedor, Producto, Venta, Compra, DetalleVenta, DetalleCompra
from .validators import (CategoriaValidator, ClienteValidator, ProveedorValidator,
                         ProductoValidator, VentaValidator, CompraValidator, MAX_INT, MAX_TOTAL)

RESOURCES = {
    'categorias': (Categoria, CategoriaValidator), 'clientes': (Cliente, ClienteValidator),
    'proveedores': (Proveedor, ProveedorValidator), 'productos': (Producto, ProductoValidator),
    'ventas': (Venta, VentaValidator), 'compras': (Compra, CompraValidator),
}


def resource_config(resource):
    if resource not in RESOURCES:
        raise NotFound('Recurso desconocido.')
    return RESOURCES[resource]


def get_record(model, pk):
    record = model.objects.filter(pk=pk).first()
    if record is None:
        raise NotFound('El registro no existe.')
    return record


def lock_writes():
    # Un único bloqueo transaccional para este POS de pruebas evita carreras entre
    # alta/cierre/reintento, ediciones de stock y comprobaciones de referencias.
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_advisory_xact_lock(807210)')


def same_document(old, data):
    """Reintentar la misma operación es seguro; cambiar un documento contabilizado no."""
    for key, value in data.items():
        if key in ('id', 'total', 'subtotal', 'cambio'):
            continue
        if key == 'itemsJson':
            saved = list(old.items.order_by('id'))
            if len(saved) != len(value):
                return False
            for line, item in zip(saved, value):
                if line.producto_id != item['producto'].pk or line.cantidad != item['cantidad']:
                    return False
                for field in ('costo', 'precio'):
                    if field in item and item[field] != getattr(line, field):
                        return False
        elif key == 'valor_recibido' and isinstance(old, Venta) and old.metodo_pago != 'Efectivo':
            continue
        elif getattr(old, key) != value:
            return False
    return True


@transaction.atomic
def save_record(resource, payload, pk=None, partial=False):
    model, validator_class = resource_config(resource)
    lock_writes()
    old = get_record(model, pk) if pk else None
    validator = validator_class(instance=old, data=payload, partial=partial)
    validator.is_valid(raise_exception=True)
    data = dict(validator.validated_data)
    if old and 'id' in data and data['id'] != old.pk:
        raise ValidationError({'id': 'No puedes cambiar el identificador.'})
    if not old and data.get('id'):
        old = model.objects.filter(pk=data['id']).first()
        if old and not isinstance(old, (Venta, Compra)):
            raise Conflict('Ya existe ese identificador.')
    if isinstance(old, Compra) or isinstance(old, Venta) and old.estado == 'cerrada':
        if same_document(old, data):
            return old, False
        raise Conflict('No se pueden modificar documentos ya contabilizados.')
    if model in (Venta, Compra):
        return save_document(model, data, old), old is None
    if model is Categoria and any(name.casefold() == data.get('nombre', getattr(old, 'nombre', '')).casefold()
                                 for name in Categoria.objects.exclude(pk=old.pk if old else None).values_list('nombre', flat=True)):
        raise Conflict('Ya existe esa categoría.')
    if model is Producto and any(code.casefold() == data.get('codigo', getattr(old, 'codigo', '')).casefold()
                                for code in Producto.objects.exclude(pk=old.pk if old else None).values_list('codigo', flat=True)):
        raise Conflict('Ya existe ese código de producto.')
    if old:
        for key, value in data.items():
            setattr(old, key, value)
        old.save()
        return old, False
    return model.objects.create(**data), True


def save_document(model, data, old):
    sale = model is Venta
    items = data.pop('itemsJson', None)
    if items is None:
        if old is None:
            raise ValidationError({'itemsJson': 'Este campo es obligatorio.'})
        items = [{'producto': line.producto, 'cantidad': line.cantidad, 'costo': line.costo} for line in old.items.all()]
    for key in ('total', 'subtotal', 'cambio'):
        data.pop(key, None)
    record = old or model()
    for key, value in data.items():
        setattr(record, key, value)
    products = {p.pk: p for p in Producto.objects.select_for_update().filter(pk__in=[i['producto'].pk for i in items]).order_by('pk')}
    snapshots = []
    amount = 0
    for item in items:
        product = products.get(item['producto'].pk)
        if product is None:
            raise ValidationError({'itemsJson': 'Un producto ya no existe.'})
        cost = product.costo if sale else item.get('costo')
        if cost is None:
            raise ValidationError({'itemsJson': 'Cada producto de compra requiere costo.'})
        qty = item['cantidad']
        amount += qty * (product.precio if sale else cost)
        snapshots.append({'producto': product, 'codigo': product.codigo, 'nombre': product.nombre,
                          'precio': product.precio, 'costo': cost, 'cantidad': qty})
    if amount > MAX_TOTAL:
        raise ValidationError({'total': 'El total supera el máximo permitido.'})
    record.total = amount
    if sale:
        record.subtotal = amount
        if record.metodo_pago == 'Debe':
            record.valor_recibido = 0
            if record.estado == 'cerrada' and not record.cliente_id:
                raise ValidationError({'clienteId': 'El pago Debe requiere un cliente.'})
        elif record.metodo_pago == 'Nequi':
            record.valor_recibido = amount
        if record.estado == 'cerrada' and record.metodo_pago == 'Efectivo' and record.valor_recibido < amount:
            raise ValidationError({'valorRecibido': 'Debe cubrir el total de la venta.'})
        record.cambio = record.valor_recibido - amount if record.estado == 'cerrada' and record.metodo_pago == 'Efectivo' else 0
    apply_inventory = not sale or record.estado == 'cerrada'
    if apply_inventory:
        for line in snapshots:
            product = line['producto']
            if product.seguimiento_inventario:
                stock = product.stock + (-line['cantidad'] if sale else line['cantidad'])
                if stock < 0:
                    raise ValidationError({'stock': f'Stock insuficiente para {product.nombre}. Disponible: {product.stock}'})
                if stock > MAX_INT:
                    raise ValidationError({'stock': 'El stock supera el máximo permitido.'})
                product.stock = stock
            if not sale:
                product.costo = line['costo']
            product.save(update_fields=['stock', 'costo'])
    record.save()
    record.items.all().delete()
    detail = DetalleVenta if sale else DetalleCompra
    parent = 'venta' if sale else 'compra'
    detail.objects.bulk_create([detail(**{parent: record}, **line) for line in snapshots])
    return record


@transaction.atomic
def delete_record(resource, pk):
    model, _ = resource_config(resource)
    lock_writes()
    record = get_record(model, pk)
    if isinstance(record, Compra) or isinstance(record, Venta) and record.estado == 'cerrada':
        raise Conflict('No se pueden eliminar documentos ya contabilizados.')
    record.delete()
