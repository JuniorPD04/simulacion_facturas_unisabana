"""RN-10: normalización de nombres para agrupar faltantes equivalentes.

Reutilizado por FaltanteValidator (validators.py) al registrar y por
services.resumen_faltantes al agrupar, para que "Cofia", "cofias" y "COFÍAS"
terminen en la misma clave.
"""
import re
import unicodedata

VOWELS = frozenset('aeiou')


def _singularize_word(word):
    # Plural regular del español: vocal+s -> quita la "s" (cofias->cofia);
    # consonante+es -> quita "es" (colores->color). Palabras de 3 letras o
    # menos no se tocan, para no deformar palabras cortas que no son plurales
    # (ver limitaciones documentadas en README).
    if len(word) <= 3:
        return word
    if word.endswith('es') and word[-3] not in VOWELS:
        return word[:-2]
    if word.endswith('s') and word[-2] in VOWELS:
        return word[:-1]
    return word


def normalizar_nombre(value):
    """Minúsculas, sin tildes/diacríticos, espacios colapsados y singular
    simple palabra por palabra.

    Límites conocidos (documentados también en el README): no corrige
    plurales irregulares con cambio ortográfico como "lápices" -> "lápiz"
    (el singular por -z/-ces no se detecta: queda "lapic"), ni palabras
    invariantes que ya terminan en "s" en singular (p. ej. "lunes",
    "paraguas"), que pueden truncarse de más.
    """
    text = unicodedata.normalize('NFKD', value or '')
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r'\s+', ' ', text).strip()
    if not text:
        return ''
    return ' '.join(_singularize_word(word) for word in text.split(' '))
