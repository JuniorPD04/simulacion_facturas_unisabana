from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from facturacion import services
from facturacion.auth import CorreccionPermission, ReembolsoPermission
from facturacion.serializers import record_json


class CorregirVentaController(APIView):
    permission_classes = [IsAuthenticated, CorreccionPermission]

    def post(self, request, pk):
        venta = services.correct_sale(pk, request.data, request.user)
        return Response({'success': True, 'data': record_json(venta)})


class ReembolsarVentaController(APIView):
    permission_classes = [IsAuthenticated, ReembolsoPermission]

    def post(self, request, pk):
        reembolso, created = services.create_refund(pk, request.data, request.user)
        return Response({'success': True, 'data': record_json(reembolso.venta)}, status=201 if created else 200)
