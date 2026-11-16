"""Validadores de entrada: tipos JSON estrictos, referencias y reglas por campo."""
import json
from rest_framework import serializers
from .models import (Categoria, Cliente, Proveedor, Producto, Descuento, DESCUENTO_TIPOS, Venta, Compra,
                     Faltante, FALTANTE_TIPOS)
from .normalizacion import normalizar_nombre

MAX_INT = 2147483647
MAX_TOTAL = 9007199254740991  # Entero exacto también en el frontend JavaScript.


class StrictInput:
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({'body': 'Se requiere un objeto JSON.'})
        unknown = set(data) - set(self.fields)
        errors = {key: 'Campo desconocido.' for key in sorted(unknown)}
        for name, value in data.items():
            field = self.fields.get(name)
            if not field or field.read_only or value is None:
                continue
            expected = None
            if isinstance(field, serializers.BooleanField):
                expected = bool
            elif isinstance(field, serializers.IntegerField):
                expected = int
            elif isinstance(field, (serializers.CharField, serializers.UUIDField, serializers.PrimaryKeyRelatedField, serializers.DateTimeField, serializers.DateField, serializers.ChoiceField)):
                expected = str
            if expected and type(value) is not expected:
                errors[name] = 'Tipo JSON incorrecto: se esperaba ' + expected.__name__ + '.'
        if errors:
            raise serializers.ValidationError(errors)
        return super().to_internal_value(data)


class BaseValidator(StrictInput, serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)


class CategoriaValidator(BaseValidator):
    class Meta:
        model = Categoria
        fields = ['id', 'nombre']


class ClienteValidator(BaseValidator):
    class Meta:
        model = Cliente
        fields = ['id', 'nombre', 'telefono', 'correo']


class ProveedorValidator(ClienteValidator):
    class Meta(ClienteValidator.Meta):
        model = Proveedor


class ProductoValidator(BaseValidator):
    categoriaId = serializers.PrimaryKeyRelatedField(source='categoria', queryset=Categoria.objects.all(), pk_field=serializers.UUIDField())
    seguimientoInventario = serializers.BooleanField(source='seguimiento_inventario', required=True)
    precio = serializers.IntegerField(min_value=0, max_value=MAX_INT)
    costo = serializers.IntegerField(min_value=0, max_value=MAX_INT)
    stock = serializers.IntegerField(min_value=0, max_value=MAX_INT)

    class Meta:
        model = Producto
        fields = ['id', 'codigo', 'nombre', 'categoriaId', 'precio', 'costo', 'seguimientoInventario', 'stock']

    def validate(self, data):
        tracked = data.get('seguimiento_inventario', getattr(self.instance, 'seguimiento_inventario', True))
        if not tracked:
            data['stock'] = 0
        return data


class ItemValidator(StrictInput, serializers.Serializer):
    productoId = serializers.PrimaryKeyRelatedField(source='producto', queryset=Producto.objects.all(), pk_field=serializers.UUIDField())
    cantidad = serializers.IntegerField(min_value=1, max_value=MAX_INT)
    # Se aceptan las instantáneas del frontend, pero venta usa precios del servidor.
    codigo = serializers.CharField(max_length=60, required=False)
    nombre = serializers.CharField(max_length=150, required=False)
    precio = serializers.IntegerField(min_value=0, max_value=MAX_INT, required=False)
    costo = serializers.IntegerField(min_value=0, max_value=MAX_INT, required=False)


class OptionalClient(serializers.PrimaryKeyRelatedField):
    """Genérico pese al nombre: trata '' como "sin relación" en vez de un UUID
    inválido. Se reutiliza para clienteId y descuentoId."""
    def run_validation(self, data=serializers.empty):
        return super().run_validation(None if data == '' else data)


class DescuentoValidator(BaseValidator):
    tipo = serializers.ChoiceField(choices=list(DESCUENTO_TIPOS))
    valor = serializers.IntegerField(min_value=1, max_value=MAX_INT)

    class Meta:
        model = Descuento
        fields = ['id', 'nombre', 'tipo', 'valor']

    def validate(self, data):
        tipo = data.get('tipo', getattr(self.instance, 'tipo', None))
        valor = data.get('valor', getattr(self.instance, 'valor', None))
        if tipo == 'porcentual' and valor is not None and valor > 100:
            raise serializers.ValidationError({'valor': 'El descuento porcentual debe estar entre 1 y 100.'})
        return data


def validate_items_json(value):
    """Compartida por DocumentValidator (ventas/compras) y CorreccionValidator."""
    try:
        items = json.loads(value)
    except (ValueError, TypeError):
        raise serializers.ValidationError('Debe contener un arreglo JSON válido.')
    if not isinstance(items, list) or not 1 <= len(items) <= 500:
        raise serializers.ValidationError('Incluye entre 1 y 500 productos.')
    validator = ItemValidator(data=items, many=True)
    validator.is_valid(raise_exception=True)
    ids = [item['producto'].pk for item in validator.validated_data]
    if len(ids) != len(set(ids)):
        raise serializers.ValidationError('No repitas productos en el detalle.')
    return validator.validated_data


class DocumentValidator(BaseValidator):
    itemsJson = serializers.CharField(write_only=True)
    total = serializers.IntegerField(min_value=0, max_value=MAX_TOTAL, required=False)

    def validate_itemsJson(self, value):
        return validate_items_json(value)


class VentaValidator(DocumentValidator):
    clienteId = OptionalClient(source='cliente', queryset=Cliente.objects.all(), allow_null=True, required=False, pk_field=serializers.UUIDField())
    # Solo la referencia es input; nombre/tipo/valor/monto son una copia que
    # calcula y guarda services.save_document (de solo lectura aqui, como
    # actualizadoEn, para que reenviar la respuesta tal cual al reintentar un
    # cierre no choque con "campo desconocido").
    descuentoId = OptionalClient(source='descuento', queryset=Descuento.objects.all(), allow_null=True, required=False, pk_field=serializers.UUIDField())
    descuentoNombre = serializers.CharField(source='descuento_nombre', read_only=True)
    descuentoTipo = serializers.CharField(source='descuento_tipo', read_only=True)
    descuentoValor = serializers.IntegerField(source='descuento_valor', read_only=True)
    descuentoMonto = serializers.IntegerField(source='descuento_monto', read_only=True)
    metodoPago = serializers.ChoiceField(source='metodo_pago', choices=['Efectivo', 'Nequi', 'Debe'])
    valorRecibido = serializers.IntegerField(source='valor_recibido', min_value=0, max_value=MAX_TOTAL)
    subtotal = serializers.IntegerField(min_value=0, max_value=MAX_TOTAL, required=False)
    cambio = serializers.IntegerField(min_value=0, max_value=MAX_TOTAL, required=False)
    actualizadoEn = serializers.DateTimeField(source='actualizado_en', read_only=True)
    # Trazabilidad de la correccion (RF-51/RNF-06); nunca son input del cliente,
    # pero se declaran de solo lectura para poder reenviar la respuesta tal
    # cual al reintentar un cierre sin chocar con "campo desconocido".
    corregida = serializers.BooleanField(read_only=True)
    corregidaPor = serializers.CharField(source='corregida_por_nombre', read_only=True)
    corregidaEn = serializers.DateTimeField(source='corregida_en', read_only=True)
    # Trazabilidad de reembolsos (RF-60.../RNF-06); igual que los de arriba,
    # de solo lectura para poder reenviar una respuesta previa sin chocar con
    # "campo desconocido" (el reembolso nunca se crea por esta vía).
    estadoReembolso = serializers.CharField(source='estado_reembolso', read_only=True)
    totalReembolsado = serializers.IntegerField(source='total_reembolsado', read_only=True)
    reembolsos = serializers.JSONField(read_only=True, required=False)

    class Meta:
        model = Venta
        fields = ['id', 'fecha', 'estado', 'clienteId', 'metodoPago', 'valorRecibido', 'subtotal',
                  'descuentoId', 'descuentoNombre', 'descuentoTipo', 'descuentoValor', 'descuentoMonto',
                  'total', 'cambio', 'itemsJson', 'actualizadoEn', 'corregida', 'corregidaPor', 'corregidaEn',
                  'estadoReembolso', 'totalReembolsado', 'reembolsos']


class CorreccionValidator(StrictInput, serializers.Serializer):
    """Campos corregibles de una venta cerrada (3.4/RF-50): items, cliente y
    metodo de pago. El descuento NO esta aqui a proposito: no es corregible,
    services.correct_sale conserva su copia congelada tal cual."""
    itemsJson = serializers.CharField()
    clienteId = OptionalClient(source='cliente', queryset=Cliente.objects.all(), allow_null=True, required=False, pk_field=serializers.UUIDField())
    metodoPago = serializers.ChoiceField(source='metodo_pago', choices=['Efectivo', 'Nequi', 'Debe'])
    valorRecibido = serializers.IntegerField(source='valor_recibido', min_value=0, max_value=MAX_TOTAL)

    def validate_itemsJson(self, value):
        return validate_items_json(value)


class ReembolsoItemValidator(StrictInput, serializers.Serializer):
    productoId = serializers.PrimaryKeyRelatedField(source='producto', queryset=Producto.objects.all(), pk_field=serializers.UUIDField())
    cantidad = serializers.IntegerField(min_value=1, max_value=MAX_INT)
    # Explicito por linea (RF-61/3.9): no hay un default implicito en la API,
    # aunque la UI lo muestre marcado por defecto.
    retornaInventario = serializers.BooleanField(source='retorna_inventario')


def validate_refund_items(value):
    try:
        raw = json.loads(value)
    except (ValueError, TypeError):
        raise serializers.ValidationError('Debe contener un arreglo JSON válido.')
    if not isinstance(raw, list) or len(raw) > 500:
        raise serializers.ValidationError('Incluye como máximo 500 productos.')
    if not raw:
        return []
    validator = ReembolsoItemValidator(data=raw, many=True)
    validator.is_valid(raise_exception=True)
    items = validator.validated_data
    ids = [item['producto'].pk for item in items]
    if len(ids) != len(set(ids)):
        raise serializers.ValidationError('No repitas productos en el mismo reembolso.')
    return items


class ReembolsoValidator(StrictInput, serializers.Serializer):
    """Reembolso parcial o total de una venta cerrada (3.5/RF-60/61). 'total'
    es el único indicador de modalidad: en ese caso itemsJson debe venir
    vacío (el backend calcula todo lo pendiente); en modo parcial, itemsJson
    es obligatorio. El id lo genera el cliente, para reintentos idempotentes."""
    id = serializers.UUIDField(required=False)
    total = serializers.BooleanField(required=False, default=False)
    itemsJson = serializers.CharField(required=False, default='[]')

    def validate_itemsJson(self, value):
        return validate_refund_items(value)

    def validate(self, data):
        if data.get('total'):
            if data.get('itemsJson'):
                raise serializers.ValidationError({'itemsJson': 'No envíes líneas junto con un reembolso total.'})
        elif not data.get('itemsJson'):
            raise serializers.ValidationError({'itemsJson': 'Incluye al menos un producto.'})
        return data


class FaltanteValidator(StrictInput, serializers.Serializer):
    """Registro de demanda no atendida (3.7/RF-150..155). "agotado" exige un
    producto existente (su nombre se copia tal cual, no es input libre);
    "no_registrado" exige nombre en texto libre y no lleva producto."""
    tipo = serializers.ChoiceField(choices=list(FALTANTE_TIPOS))
    productoId = OptionalClient(source='producto', queryset=Producto.objects.all(), allow_null=True, required=False, pk_field=serializers.UUIDField())
    nombre = serializers.CharField(max_length=150, required=False, allow_blank=True)
    cantidadSolicitada = serializers.IntegerField(source='cantidad_solicitada', min_value=1, max_value=MAX_INT)
    proveedorId = OptionalClient(source='proveedor', queryset=Proveedor.objects.all(), allow_null=True, required=False, pk_field=serializers.UUIDField())
    observacion = serializers.CharField(max_length=300, required=False, allow_blank=True)

    def validate(self, data):
        tipo = data.get('tipo')
        producto = data.get('producto')
        if tipo == 'agotado':
            if not producto:
                raise serializers.ValidationError({'productoId': 'El tipo "agotado" requiere un producto existente.'})
            data['nombre'] = producto.nombre
        else:  # no_registrado
            if producto:
                raise serializers.ValidationError({'productoId': 'El tipo "no registrado" no lleva producto.'})
            nombre = (data.get('nombre') or '').strip()
            if not nombre:
                raise serializers.ValidationError({'nombre': 'El tipo "no registrado" requiere un nombre.'})
            data['nombre'] = nombre
        data['nombre_normalizado'] = normalizar_nombre(data['nombre'])
        data.setdefault('observacion', '')
        return data


class CompraValidator(DocumentValidator):
    proveedorId = serializers.PrimaryKeyRelatedField(source='proveedor', queryset=Proveedor.objects.all(), pk_field=serializers.UUIDField())

    class Meta:
        model = Compra
        fields = ['id', 'fecha', 'proveedorId', 'total', 'itemsJson']


class LoginValidator(StrictInput, serializers.Serializer):
    usuario = serializers.CharField(max_length=60)
    contrasena = serializers.CharField(max_length=128)
