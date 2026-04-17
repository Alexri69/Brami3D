# Migraciones SQL — Brami3D

Scripts para ejecutar en el **SQL Editor de Supabase**. Ejecutar en orden numérico, una sola vez cada uno.

| Archivo | Fecha | Descripción |
|---|---|---|
| `001_verifactu_registros.sql` | 2026-04-17 | Fase 1 Verifactu: tablas `facturas_registro` + `facturas_eventos` inmutables con hash encadenado SHA-256, trigger defensivo contra UPDATE/DELETE y políticas RLS (SELECT+INSERT sólo al propietario). Cumple RD 1007/2023 modo No-Verifactu. |

## Cómo ejecutar

1. Supabase Dashboard → **SQL Editor** → **New query**
2. Pegar el contenido del archivo `.sql`
3. **Run**
4. Verificar que no haya errores y que ambas tablas aparezcan en **Table Editor**

## Verificación rápida (Fase 1)

```sql
-- Deberían aparecer 2 filas, ambas con rowsecurity = t
select tablename, rowsecurity from pg_tables
  where schemaname='public' and tablename like 'facturas%';

-- Intentar un UPDATE debe fallar con la excepción del trigger
-- (primero insertar una fila dummy desde el cliente o con service_role)
-- update facturas_registro set factura_num='X' where id = '...';
```
