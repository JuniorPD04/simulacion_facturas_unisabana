from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from facturacion import accounts
from facturacion.serializers import usuario_json
from facturacion.validators import LoginValidator


class LoginController(APIView):
    # Sin authentication_classes, DRF no puede armar un encabezado
    # WWW-Authenticate y reescribe cualquier AuthenticationFailed como 403;
    # se captura aquí para que credenciales incorrectas respondan 401.
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        validator = LoginValidator(data=request.data)
        validator.is_valid(raise_exception=True)
        try:
            usuario = accounts.authenticate(validator.validated_data['usuario'], validator.validated_data['contrasena'])
        except AuthenticationFailed as exc:
            return Response({'success': False, 'message': str(exc.detail)}, status=401)
        session = accounts.create_session(usuario)
        return Response({'success': True, 'data': {'token': session.pk, 'usuario': usuario_json(usuario)}})


class LogoutController(APIView):
    def post(self, request):
        accounts.revoke_session(request.auth)
        return Response({'success': True, 'data': {}})


class MeController(APIView):
    def get(self, request):
        return Response({'success': True, 'data': usuario_json(request.user)})
