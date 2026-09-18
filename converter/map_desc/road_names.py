"""Language-independent naming contract, mirrored by converter/road-names.js."""
from typing import Any, Dict, Optional


# Preserve all usable name candidates so the browser can select its language.
def name_candidates(tags: Optional[Dict[str, Any]]) -> Dict[str, str]:
    return {
        key: value.strip()
        for key, value in (tags or {}).items()
        if (key in ('name', 'loc_name', 'short_name') or key.startswith('name:'))
        and isinstance(value, str) and value.strip()
    }


# Resolve the default name deterministically, without privileging a language.
def resolve_name(tags: Optional[Dict[str, Any]]) -> Optional[str]:
    names = name_candidates(tags)
    keys = ['name'] + sorted(key for key in names if key.startswith('name:'))
    keys += ['loc_name', 'short_name']
    return next((names[key] for key in keys if key in names), None)
