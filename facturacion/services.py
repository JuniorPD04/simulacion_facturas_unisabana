"""Reglas de negocio y transacciones; los controladores no modifican inventario."""
import uuid
from django.db import connection, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from .errors import Conflict
from .models import (Categoria, Cliente, Proveedor, Producto, Descuento, Venta, Compra, DetalleVenta, DetalleCompra,
                     Reembolso, DetalleReembolso, Faltante)
from .validators import (CategoriaValidator, ClienteValidator, ProveedorValidator, ProductoValidator,
                         DescuentoValidator, VentaValidator, CompraValidator, CorreccionValidator,
                         ReembolsoValidator, FaltanteValidator, MAX_INT, MAX_TOTAL)

RESOURCES = {
    'categorias': (Categoria, CategoriaValidator), 'clientes': (Cliente, ClienteValidator),
    'proveedores': (Proveedor, ProveedorValidator), 'productos': (Producto, ProductoValidator),
    'descuentos': (Descuento, DescuentoValidator),
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
    previous_descuento_id = old.descuento_id if sale and old else None  # antes de que el setattr lo pise (record ES old).
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
        # El monto se recalcula en cada guardado (igual que los items), pero el
        # catalogo solo se vuelve a leer si el descuento realmente cambio (se
        # aplico uno nuevo o se quito). Si sigue siendo el mismo, se usa la
        # copia ya congelada: editar o eliminar el descuento del catalogo no
        # debe alterar una venta (abierta o, via correccion, cerrada) que ya
        # lo tenia aplicado.
        descuento_changed = old is None or record.descuento_id != previous_descuento_id
        if record.descuento_id:
            if descuento_changed:
                nombre, tipo, valor = record.descuento.nombre, record.descuento.tipo, record.descuento.valor
            else:
                nombre, tipo, valor = old.descuento_nombre, old.descuento_tipo, old.descuento_valor
            monto = amount * valor // 100 if tipo == 'porcentual' else valor
            if monto > amount:
                raise ValidationError({'descuentoId': f'El descuento "{nombre}" supera el subtotal. Quítalo o ajusta los productos.'})
            record.descuento_nombre, record.descuento_tipo, record.descuento_valor = nombre, tipo, valor
            record.descuento_monto = monto
        else:
            record.descuento_nombre, record.descuento_tipo, record.descuento_valor, record.descuento_monto = '', '', None, 0
        record.total = amount - record.descuento_monto
        if record.metodo_pago == 'Debe':
            record.valor_recibido = 0
            if record.estado == 'cerrada' and not record.cliente_id:
                raise ValidationError({'clienteId': 'El pago Debe requiere un cliente.'})
        elif record.metodo_pago == 'Nequi':
            record.valor_recibido = record.total
        if record.estado == 'cerrada' and record.metodo_pago == 'Efectivo' and record.valor_recibido < record.total:
            raise ValidationError({'valorRecibido': 'Debe cubrir el total de la venta.'})
        record.cambio = record.valor_recibido - record.total if record.estado == 'cerrada' and record.metodo_pago == 'Efectivo' else 0
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


def ensure_sale_has_no_refunds(venta):
    """Regla del equipo (3.5/3.9): una venta con al menos un reembolso ya NO
    se puede corregir. Se llama antes de que correct_sale toque inventario o
    totales."""
    if venta.reembolsos.exists():
        raise Conflict('Esta venta tiene reembolsos registrados; ya no se puede corregir.')


@transaction.atomic
def correct_sale(pk, payload, usuario):
    """Corrige una venta CERRADA (3.4/RF-50): servicio propio, separado de
    save_record/save_document, que evita a proposito el candado de documentos
    contabilizados en vez de debilitarlo para las rutas normales de ventas."""
    lock_writes()
    venta = get_record(Venta, pk)
    if venta.estado != 'cerrada':
        raise ValidationError({'estado': 'Solo se pueden corregir ventas cerradas.'})
    ensure_sale_has_no_refunds(venta)
    validator = CorreccionValidator(data=payload)
    validator.is_valid(raise_exception=True)
    data = dict(validator.validated_data)
    items = data.pop('itemsJson')
    # Precio/costo unitario (confirmado con el modelo actual): las lineas que
    # YA EXISTIAN conservan el valor con el que estaban guardadas; solo las
    # agregadas en esta correccion usan el precio/costo vigente del producto.
    previous_lines = {line.producto_id: line for line in venta.items.all()}
    for key, value in data.items():
        setattr(venta, key, value)
    product_ids = sorted({item['producto'].pk for item in items} | set(previous_lines))
    products = {p.pk: p for p in Producto.objects.select_for_update().filter(pk__in=product_ids).order_by('pk')}
    snapshots = []
    amount = 0
    for item in items:
        product = products.get(item['producto'].pk)
        if product is None:
            raise ValidationError({'itemsJson': 'Un producto ya no existe.'})
        previous = previous_lines.get(product.pk)
        precio = previous.precio if previous else product.precio
        costo = previous.costo if previous else product.costo
        qty = item['cantidad']
        amount += qty * precio
        snapshots.append({'producto': product, 'codigo': product.codigo, 'nombre': product.nombre,
                          'precio': precio, 'costo': costo, 'cantidad': qty})
    if amount > MAX_TOTAL:
        raise ValidationError({'total': 'El total supera el máximo permitido.'})
    venta.subtotal = amount
    # El descuento no es corregible (no esta en CorreccionValidator): se
    # conserva tal cual la copia congelada, solo se recalcula el monto sobre
    # el nuevo subtotal.
    if venta.descuento_tipo:
        monto = amount * venta.descuento_valor // 100 if venta.descuento_tipo == 'porcentual' else venta.descuento_valor
        if monto > amount:
            raise ValidationError({'descuentoId': f'El descuento "{venta.descuento_nombre}" supera el nuevo subtotal. Ajusta los productos.'})
        venta.descuento_monto = monto
    venta.total = amount - venta.descuento_monto
    if venta.metodo_pago == 'Debe':
        venta.valor_recibido = 0
        if not venta.cliente_id:
            raise ValidationError({'clienteId': 'El pago Debe requiere un cliente.'})
    elif venta.metodo_pago == 'Nequi':
        venta.valor_recibido = venta.total
    if venta.metodo_pago == 'Efectivo' and venta.valor_recibido < venta.total:
        raise ValidationError({'valorRecibido': 'Debe cubrir el total de la venta.'})
    venta.cambio = venta.valor_recibido - venta.total if venta.metodo_pago == 'Efectivo' else 0
    # Inventario por la DIFERENCIA entre la venta original y la corregida
    # (RN-06/3.9), solo para productos con seguimiento. Se valida TODO antes
    # de guardar nada: un reenvio identico calcula diferencia 0 (idempotente).
    new_quantities = {s['producto'].pk: s['cantidad'] for s in snapshots}
    pending_stock = {}
    for pid in product_ids:
        product = products[pid]
        if not product.seguimiento_inventario:
            continue
        old_qty = previous_lines[pid].cantidad if pid in previous_lines else 0
        new_qty = new_quantities.get(pid, 0)
        stock = product.stock - (new_qty - old_qty)
        if stock < 0:
            raise ValidationError({'stock': f'Stock insuficiente para {product.nombre}. Disponible: {product.stock}'})
        if stock > MAX_INT:
            raise ValidationError({'stock': 'El stock supera el máximo permitido.'})
        pending_stock[pid] = stock
    for pid, stock in pending_stock.items():
        products[pid].stock = stock
        products[pid].save(update_fields=['stock'])
    venta.corregida = True
    venta.corregida_por = usuario
    venta.corregida_por_nombre = usuario.usuario
    venta.corregida_en = timezone.now()
    venta.save()
    venta.items.all().delete()
    DetalleVenta.objects.bulk_create([DetalleVenta(venta=venta, **line) for line in snapshots])
    return venta


@transaction.atomic
def create_refund(pk, payload, usuario):
    """Reembolso parcial o total de una venta CERRADA (3.5/3.9, RF-60..65).
    Endpoint y servicio propios (POST /api/ventas/{id}/reembolsos/), no un
    recurso mas de services.RESOURCES: un reembolso no reemplaza ni sustituye
    a la venta, solo le agrega un documento asociado; mezclarlo con
    save_record hubiera significado simular una "actualizacion" de venta que
    en realidad nunca cambia sus items ni sus totales originales."""
    lock_writes()
    venta = get_record(Venta, pk)
    if venta.estado != 'cerrada':
        raise ValidationError({'estado': 'Solo se pueden reembolsar ventas cerradas.'})
    validator = ReembolsoValidator(data=payload)
    validator.is_valid(raise_exception=True)
    data = dict(validator.validated_data)
    refund_id = data.get('id') or uuid.uuid4()

    # Idempotencia PRIMERO, con el input ya validado tal cual se recibio, sin
    # involucrar lo "pendiente": una vez que un reembolso "total" ya cubrio
    # todo lo que quedaba, lo pendiente pasa a ser 0 y ya no hay como
    # recalcularlo para reconocer que el reenvio es el mismo que antes.
    existing = Reembolso.objects.filter(pk=refund_id).first()
    if existing is not None:
        if existing.venta_id != venta.pk:
            raise Conflict('Ya existe un reembolso con ese identificador para otra venta.')
        if data['total'] != existing.es_total:
            raise Conflict('Ya existe un reembolso con ese identificador.')
        if not data['total']:
            existing_by_product = {d.producto_id: d for d in existing.items.all()}
            requested_by_product = {item['producto'].pk: item for item in data['itemsJson']}
            same = set(existing_by_product) == set(requested_by_product) and all(
                existing_by_product[pid].cantidad == requested_by_product[pid]['cantidad']
                and existing_by_product[pid].retorna_inventario == requested_by_product[pid]['retorna_inventario']
                for pid in existing_by_product)
            if not same:
                raise Conflict('Ya existe un reembolso con ese identificador.')
        return existing, False  # Reenvio identico: idempotente, no repite monto ni stock.

    # Bajo el mismo candado: lineas de la venta y cuanto de cada una ya se
    # reembolso, para que dos reembolsos simultaneos no superen lo vendido.
    lines = {line.pk: line for line in DetalleVenta.objects.select_for_update().filter(venta=venta).order_by('pk')}
    refunded_so_far = dict.fromkeys(lines, 0)
    totals = (DetalleReembolso.objects.filter(linea_id__in=lines.keys())
              .values('linea_id').annotate(total=Sum('cantidad')))
    for row in totals:
        refunded_so_far[row['linea_id']] = row['total']
    by_product = {line.producto_id: line for line in lines.values()}

    if data['total']:
        requested = []
        for line in lines.values():
            pending = line.cantidad - refunded_so_far[line.pk]
            if pending > 0:
                requested.append({'linea': line, 'cantidad': pending, 'retorna_inventario': True})
        if not requested:
            raise ValidationError({'total': 'No queda nada pendiente de reembolsar en esta venta.'})
    else:
        requested = []
        for item in data['itemsJson']:
            line = by_product.get(item['producto'].pk)
            if line is None:
                raise ValidationError({'itemsJson': f'{item["producto"].nombre} no está en esta venta.'})
            pending = line.cantidad - refunded_so_far[line.pk]
            if item['cantidad'] > pending:
                raise ValidationError({'itemsJson': f'Disponible para reembolsar de {line.nombre}: {pending} (ya reembolsado: {refunded_so_far[line.pk]}).'})
            requested.append({'linea': line, 'cantidad': item['cantidad'], 'retorna_inventario': item['retorna_inventario']})

    # Monto proporcional (RF-62/3.5) sin deriva de redondeo: se lleva un
    # acumulado GLOBAL (de toda la venta, no por linea) del subtotal ya
    # reembolsado, y el monto de cada linea de ESTE reembolso es la
    # diferencia entre el redondeo de ese acumulado despues y antes de
    # sumarla. Al reembolsar por completo, el acumulado llega exactamente a
    # subtotal y el redondeo da total exacto (protege subtotal == 0).
    subtotal, total_amount = venta.subtotal, venta.total
    running = sum(line.precio * refunded_so_far[line.pk] for line in lines.values())

    def floor_amount(subtotal_acumulado):
        return 0 if subtotal == 0 else subtotal_acumulado * total_amount // subtotal

    detail_rows = []
    refund_total = 0
    for item in sorted(requested, key=lambda r: r['linea'].pk):
        before = floor_amount(running)
        running += item['linea'].precio * item['cantidad']
        after = floor_amount(running)
        monto = after - before
        refund_total += monto
        detail_rows.append({'linea': item['linea'], 'producto': item['linea'].producto, 'cantidad': item['cantidad'],
                            'retorna_inventario': item['retorna_inventario'], 'monto': monto})

    # Inventario (3.9/RN-05): solo si retorna_inventario y el producto tiene
    # seguimiento; se bloquean en orden deterministico, igual que en el resto
    # de servicios de escritura.
    product_ids = sorted({row['producto'].pk for row in detail_rows})
    products = {p.pk: p for p in Producto.objects.select_for_update().filter(pk__in=product_ids).order_by('pk')}
    for row in detail_rows:
        product = products[row['producto'].pk]
        if row['retorna_inventario'] and product.seguimiento_inventario:
            stock = product.stock + row['cantidad']
            if stock > MAX_INT:
                raise ValidationError({'stock': 'El stock supera el máximo permitido.'})
            product.stock = stock
    for product in products.values():
        product.save(update_fields=['stock'])

    reembolso = Reembolso.objects.create(id=refund_id, venta=venta, usuario=usuario, usuario_nombre=usuario.usuario,
                                         monto=refund_total, es_total=data['total'])
    DetalleReembolso.objects.bulk_create([
        DetalleReembolso(reembolso=reembolso, linea=row['linea'], producto=row['producto'], cantidad=row['cantidad'],
                         retorna_inventario=row['retorna_inventario'], monto=row['monto'])
        for row in detail_rows])
    return reembolso, True
