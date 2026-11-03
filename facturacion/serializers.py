"""Representación pública, conservando los nombres usados por el frontend."""
import json
from django.forms.models import model_to_dict
from .models import Producto, Venta, Compra


def record_json(record):
    if isinstance(record, Producto):
        return {'id': str(record.pk), 'codigo': record.codigo, 'nombre': record.nombre,
                'categoriaId': str(record.categoria_id), 'categoria_id': str(record.categoria_id),
                'precio': record.precio, 'costo': record.costo,
                'seguimientoInventario': record.seguimiento_inventario, 'stock': record.stock}
    if isinstance(record, (Venta, Compra)):
        items = [{'productoId': str(i.producto_id), 'codigo': i.codigo, 'nombre': i.nombre,
                  'precio': i.precio, 'costo': i.costo, 'cantidad': i.cantidad} for i in record.items.order_by('id')]
        result = {'id': str(record.pk), 'fecha': record.fecha.isoformat(), 'total': record.total,
                  'itemsJson': json.dumps(items, ensure_ascii=False)}
        if isinstance(record, Venta):
            result.update(estado=record.estado, clienteId=str(record.cliente_id or ''),
                          cliente_id=str(record.cliente_id or ''), metodoPago=record.metodo_pago,
                          subtotal=record.subtotal, valorRecibido=record.valor_recibido,
                          cambio=record.cambio, actualizadoEn=record.actualizado_en.isoformat())
        else:
            result.update(proveedorId=str(record.proveedor_id), proveedor_id=str(record.proveedor_id))
        return result
    return {'id': str(record.pk), **model_to_dict(record, exclude=['id'])}
