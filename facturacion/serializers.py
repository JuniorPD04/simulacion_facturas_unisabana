"""Representación pública, conservando los nombres usados por el frontend."""
import json
from django.forms.models import model_to_dict
from .models import Producto, Venta, Compra


def reembolso_json(reembolso):
    # nombre de i.linea (el DetalleVenta original), no del catalogo vigente:
    # el reembolso muestra el nombre que tenia el producto cuando se vendio,
    # igual que el resto de instantaneas del proyecto (precio/costo en
    # DetalleVenta/DetalleCompra).
    items = reembolso.items.select_related('linea').order_by('id')
    return {'id': str(reembolso.pk), 'fecha': reembolso.fecha.isoformat(), 'usuario': reembolso.usuario_nombre,
            'monto': reembolso.monto, 'esTotal': reembolso.es_total,
            'items': [{'productoId': str(i.producto_id), 'nombre': i.linea.nombre, 'cantidad': i.cantidad,
                      'retornaInventario': i.retorna_inventario, 'monto': i.monto} for i in items]}


def faltante_json(faltante):
    """Faltante (3.7). Las claves son camelCase y sin sufijo _id para sobrevivir
    a SanitizeIdsMiddleware; '' significa "sin relación", como en clienteId."""
    return {'id': str(faltante.pk), 'tipo': faltante.tipo, 'productoId': str(faltante.producto_id or ''),
            'nombre': faltante.nombre, 'nombreNormalizado': faltante.nombre_normalizado, 'cantidadSolicitada': faltante.cantidad_solicitada,
            'fecha': faltante.fecha.isoformat(), 'proveedorId': str(faltante.proveedor_id or ''),
            'proveedorNombre': faltante.proveedor.nombre if faltante.proveedor_id else '',
            'observacion': faltante.observacion, 'estado': faltante.estado, 'usuario': faltante.usuario_nombre,
            'resueltoEn': faltante.resuelto_en.isoformat() if faltante.resuelto_en else None,
            'resueltoPor': faltante.resuelto_por.usuario if faltante.resuelto_por_id else None}


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
                          subtotal=record.subtotal, descuentoId=str(record.descuento_id or ''),
                          descuento_id=str(record.descuento_id or ''), descuentoNombre=record.descuento_nombre,
                          descuentoTipo=record.descuento_tipo, descuentoValor=record.descuento_valor,
                          descuentoMonto=record.descuento_monto, valorRecibido=record.valor_recibido,
                          cambio=record.cambio, actualizadoEn=record.actualizado_en.isoformat(),
                          corregida=record.corregida, corregidaPor=record.corregida_por_nombre or None,
                          corregidaEn=record.corregida_en.isoformat() if record.corregida_en else None,
                          estadoReembolso=record.estado_reembolso, totalReembolsado=record.total_reembolsado,
                          reembolsos=[reembolso_json(r) for r in record.reembolsos.order_by('fecha')])
        else:
            result.update(proveedorId=str(record.proveedor_id), proveedor_id=str(record.proveedor_id))
        return result
    return {'id': str(record.pk), **model_to_dict(record, exclude=['id'])}


def usuario_json(usuario):
    return {'id': str(usuario.pk), 'usuario': usuario.usuario, 'rol': usuario.rol}
