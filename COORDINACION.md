# 🤝 Coordinación entre agentes — MiPhoneHN

> **Nota para cualquier agente/desarrollador que trabaje sobre este repo.**
> Creada el 2026-08-29.

## Propósito

Este proyecto es mantenido por **dos agentes trabajando en paralelo** sobre el
mismo repositorio. Este documento existe para que ambos **se conozcan**: qué hace
cada uno, en qué rama trabaja, y cómo integrar el trabajo SIN pisarse.

## Ramas actuales (línea base)

| Rama | Último commit | Contenido |
|---|---|---|
| `master` | `ebf76e6` | **Base de integración oficial.** Tiene todo: variantes, mantenimiento, módulo de backup/importación, y el badge de entorno dentro del bloque de marca. |
| `feature/variantes-ficha-completa` | `2049eb8` | Trabajo histórico de variantes + ficha completa. **Ya integrado en `master`** (por cherry-pick). |
| `respaldo/copia-documents-20260829` | `0a75b9b` | Respaldo de una copia vieja del proyecto (Documents). No tocar. |

## ⚠️ Reglas de oro

1. **`master` es la fuente de verdad.** Todo lo que se quiera desplegar debe
   estar en `master`.
2. **Siempre hacer `git fetch origin` primero** y ver si el otro agente ya subió
   algo ANTES de commitear/pushear. Los mensajes de commit pueden repetirse
   (`git log` con hashes distintos) porque cada agente tiene su `.git` local.
3. **No hacer `push --force`** ni `rebase` sobre ramas remotas compartidas.
   Preferir `merge` o `cherry-pick` de cambios pequeños.
4. **Antes de integra: comparar contenido**, no solo mensajes:
   ```powershell
   git fetch origin
   git --no-pager diff HEAD origin/master --stat
   git merge-base --is-ancestor <commit> origin/master; echo $LASTEXITCODE
   ```
5. **Verificar que nada quede pendiente** al terminar:
   ```powershell
   git ls-remote --heads origin   # remoto
   git status --short             # local
   ```

## Cómo es la última integración (ejemplo a seguir)

1. `git fetch origin` → el otro agente había subido a `master` commits con los
   mismos mensajes pero otros hashes (trabajo recreado desde otra copia).
2. Se verificó que el `master` remoto ya contenía el trabajo local compartido
   (`git merge-base --is-ancestor`).
3. El único cambio faltante (badge de entorno) se integró con **`cherry-pick`**:
   ```powershell
   git checkout master
   git merge origin/master      # fast-forward
   git cherry-pick <commit>     # trae SOLO ese cambio
   git push origin master
   ```
4. Resultado: `master` quedó en `ebf76e6` con TODO el trabajo de ambos.

## Flujo recomendado para trabajar

- **En local**: trabajar con `npm run dev` (admin `localhost:5174`, tienda `localhost:5173`).
- **Al terminar**:
  1. `git fetch origin`
  2. `git checkout master && git merge origin/master`
  3. Hacer los cambios / commits
  4. `git push origin master`
  5. Actualizar la rama feature (si se usa) con `git merge master` y push.

## Datos útiles del entorno

- **Admin (producción):** https://miphonehn-admin.vercel.app/login.html
- **Tienda (producción):** https://miphonehn.vercel.app (puede estar en
  mantenimiento según el flag `mantenimiento-produccion` en Supabase).
- **Supabase:** proyecto `dtaroricdbzavktglteu`. Flags de mantenimiento en
  tabla `configuracion`. Función RLS: `public.mantenimiento_activo_prod()`.
- **Regenerar backup/scripts:** usar `scripts/export_backup_supabase.mjs` con
  `--url` y service role key (NO versionar resultados, ver `.gitignore`).

## Pendientes conocidos

- El sitio de producción puede seguir en **modo mantenimiento** (flag activo).
  Desactivarlo desde el panel (Configuración → Mantenimiento → Desactivar).
- La rama `feature/variantes-ficha-completa` es histórica: su contenido ya está
  en `master`. Si se sigue usando, simplemente hacer `git merge master` y push.

---
*Mantener este documento actualizado ayuda a que los dos agentes trabajen sobre
la misma base sin conflictos.*