/** Mirrors the backend's explicit opt-in until /server/info exposes feature state. */
export const namespaceFrontendEnabled = import.meta.env.VITE_VIRTUAL_NAMESPACES_ENABLED === 'true';
