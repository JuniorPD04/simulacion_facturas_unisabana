"""Validadores de entrada: tipos JSON estrictos, referencias y reglas por campo."""
import json
from rest_framework import serializers
from .models import Categoria, Cliente, Proveedor, Producto, Venta, Compra

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
    def run_validation(self, data=serializers.empty):
        return super().run_validation(None if data == '' else data)


class DocumentValidator(BaseValidator):
    itemsJson = serializers.CharField(write_only=True)
    total = serializers.IntegerField(min_value=0, max_value=MAX_TOTAL, required=False)

    def validate_itemsJson(self, value):
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


class VentaValidator(DocumentValidator):
    clienteId = OptionalClient(source='cliente', queryset=Cliente.objects.all(), allow_null=True, required=False, pk_field=serializers.UUIDField())
    metodoPago = serializers.ChoiceField(source='metodo_pago', choices=['Efectivo', 'Nequi', 'Debe'])
    valorRecibido = serializers.IntegerField(source='valor_recibido', min_value=0, max_value=MAX_TOTAL)
    subtotal = serializers.IntegerField(min_value=0, max_value=MAX_TOTAL, required=False)
    cambio = serializers.IntegerField(min_value=0, max_value=MAX_TOTAL, required=False)
    actualizadoEn = serializers.DateTimeField(source='actualizado_en', read_only=True)

    class Meta:
        model = Venta
        fields = ['id', 'fecha', 'estado', 'clienteId', 'metodoPago', 'valorRecibido', 'subtotal', 'total', 'cambio', 'itemsJson', 'actualizadoEn']


class CompraValidator(DocumentValidator):
    proveedorId = serializers.PrimaryKeyRelatedField(source='proveedor', queryset=Proveedor.objects.all(), pk_field=serializers.UUIDField())

    class Meta:
        model = Compra
        fields = ['id', 'fecha', 'proveedorId', 'total', 'itemsJson']
