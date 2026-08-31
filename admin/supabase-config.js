// Módulo de configuración e inicialización de Supabase y Cloudinary para Mi Phone HN (Admin)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan variables VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el .env");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// CLOUDINARY UPLOAD LAYER
// ==========================================

export async function uploadToCloudinary(fileOrBase64) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const preset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  
  if (!cloudName || !preset) {
    throw new Error("Falta la configuración de Cloudinary en las variables de entorno.");
  }
  
  const formData = new FormData();
  formData.append('file', fileOrBase64);
  formData.append('upload_preset', preset);
  
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    console.error("Error al subir a Cloudinary:", errorData);
    throw new Error(errorData.error?.message || "Error al subir la imagen a Cloudinary");
  }
  
  const data = await response.json();
  return data.secure_url;
}

// ==========================================
// COMPATIBILITY LAYER FOR SUPABASE AUTH
// ==========================================

export const auth = {
  currentUser: null
};

// Mapear el estado de autenticación
export function onAuthStateChanged(dummyAuth, callback) {
  // Obtener sesión inicial
  supabase.auth.getSession().then(({ data: { session } }) => {
    const user = session ? {
      uid: session.user.id,
      email: session.user.email,
      displayName: session.user.user_metadata?.nombre || ''
    } : null;
    auth.currentUser = user;
    callback(user);
  });
  
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const user = session ? {
      uid: session.user.id,
      email: session.user.email,
      displayName: session.user.user_metadata?.nombre || ''
    } : null;
    auth.currentUser = user;
    callback(user);
  });
  
  return () => {
    subscription.unsubscribe();
  };
}

export async function signInWithEmailAndPassword(dummyAuth, email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const user = {
    uid: data.user.id,
    email: data.user.email,
    displayName: data.user.user_metadata?.nombre || ''
  };
  auth.currentUser = user;
  return { user };
}

export async function signOut(dummyAuth) {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  auth.currentUser = null;
}

// Crear usuario independiente sin perder sesión del administrador.
// Acepta opciones { rol, nombre } que se pasan como metadata al signUp,
// de modo que el trigger handle_new_user cree el doc de usuarios con el
// rol/nombre correctos (evita doble inserción: trigger vs setDoc manual).
export async function crearUsuarioTemporal(correo, password, opciones = {}) {
  const tempClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const { data, error } = await tempClient.auth.signUp({
    email: correo,
    password: password,
    options: {
      data: {
        rol: opciones.rol || 'editor',
        nombre: opciones.nombre || ''
      }
    }
  });
  if (error) throw error;
  return { uid: data.user.id };
}

// ==========================================
// COMPATIBILITY LAYER FOR SUPABASE
// ==========================================

export const db = {}; // Dummy db ref

export function collection(dummyDb, name) {
  return { type: 'collection', name };
}

export function doc(dummyDb, name, id) {
  return { type: 'doc', name, id };
}

export function query(ref, ...clauses) {
  return { type: 'query', ref, clauses };
}

export function where(field, op, value) {
  return { type: 'where', field, op, value };
}

export function orderBy(field, dir) {
  return { type: 'orderBy', field, dir };
}

class MockDocSnap {
  constructor(id, data, name) {
    this.id = id;
    this._data = data;
    this.name = name;
  }
  exists() {
    return this._data !== null && this._data !== undefined;
  }
  data() {
    return this._data;
  }
}

class MockQuerySnap {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
  }
  forEach(cb) {
    this.docs.forEach(cb);
  }
}

// Conversión de CamelCase a SnakeCase para Postgres
const camelToSnake = {
  oldPrice: 'old_price',
  batteryHealth: 'battery_health',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  fechaCreacion: 'fecha_creacion',
  lastLogin: 'last_login'
};

const snakeToCamel = {
  old_price: 'oldPrice',
  battery_health: 'batteryHealth',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  fecha_creacion: 'fechaCreacion',
  last_login: 'lastLogin'
};

function mapKeys(obj, mapper) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => mapKeys(item, mapper));
  const res = {};
  for (const k in obj) {
    const newK = mapper[k] || k;
    res[newK] = mapKeys(obj[k], mapper);
  }
  return res;
}

export async function getDoc(docRef) {
  const table = docRef.name;
  
  if (table === 'configuracion') {
    const { data, error } = await supabase.from('configuracion').select('data').eq('key', docRef.id).maybeSingle();
    if (error || !data) return new MockDocSnap(docRef.id, null, table);
    return new MockDocSnap(docRef.id, mapKeys(data.data, snakeToCamel), table);
  }
  
  let q = supabase.from(table).select('*');
  if (table === 'usuarios') {
    if (docRef.id && (docRef.id.length === 36 || !docRef.id.includes('-'))) {
      q = q.eq('uid', docRef.id);
    } else {
      q = q.eq('id', docRef.id);
    }
  } else {
    q = q.eq('id', docRef.id);
  }
  
  const { data, error } = await q.maybeSingle();
  if (error || !data) return new MockDocSnap(docRef.id, null, table);
  
  return new MockDocSnap(data.id || docRef.id, mapKeys(data, snakeToCamel), table);
}

export async function getDocs(queryOrRef) {
  let ref = queryOrRef;
  let clauses = [];
  if (queryOrRef.type === 'query') {
    ref = queryOrRef.ref;
    clauses = queryOrRef.clauses;
  }
  
  const table = ref.name;
  let q = supabase.from(table).select('*');
  
  for (const clause of clauses) {
    if (clause.type === 'where') {
      const field = camelToSnake[clause.field] || clause.field;
      if (clause.op === '==') {
        q = q.eq(field, clause.value);
      }
    } else if (clause.type === 'orderBy') {
      const field = camelToSnake[clause.field] || clause.field;
      q = q.order(field, { ascending: clause.dir !== 'desc' });
    }
  }
  
  const { data, error } = await q;
  if (error || !data) return new MockQuerySnap([]);
  
  const docs = data.map(row => {
    let docData = mapKeys(row, snakeToCamel);
    if (table === 'configuracion') {
      docData = mapKeys(row.data, snakeToCamel);
    }
    return new MockDocSnap(row.id || row.key, docData, table);
  });
  
  return new MockQuerySnap(docs);
}

export async function setDoc(docRef, data, options = {}) {
  const table = docRef.name;
  
  if (table === 'configuracion') {
    const mappedData = mapKeys(data, camelToSnake);
    const { error } = await supabase.from('configuracion').upsert({
      key: docRef.id,
      data: mappedData,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    return;
  }
  
  let payload = mapKeys(data, camelToSnake);
  
  // merge: solo actualiza los campos enviados (semántica de Firestore).
  // Sin esto, el upsert propone una fila con las columnas faltantes en NULL,
  // lo que viola NOT NULL (p. ej. label al guardar solo image) y borraría
  // datos existentes.
  if (options.merge === true) {
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const existing = mapKeys(snap.data(), camelToSnake);
        for (const k in existing) {
          if (!(k in payload)) payload[k] = existing[k];
        }
      }
    } catch {
      // Si la fila no existe o no puede leerse, se inserta con lo enviado.
    }
  }
  
  if (table === 'usuarios') {
    if (docRef.id.length === 36 && !docRef.id.includes('-')) {
      payload.uid = docRef.id;
    } else {
      // IDs secuenciales (Usuario-Admin-N): UPDATE por id. Un upsert intentaría
      // INSERT con uid NULL cuando la fila no coincide por PK/uid, violando la
      // restricción NOT NULL de la columna uid.
      const { error: updError } = await supabase.from(table).update(payload).eq('id', docRef.id);
      if (updError) throw updError;
      return;
    }
  } else {
    payload.id = docRef.id;
  }
  
  const { error } = await supabase.from(table).upsert(payload);
  if (error) throw error;
}

export async function addDoc(collectionRef, data) {
  const table = collectionRef.name;
  const payload = mapKeys(data, camelToSnake);
  const { data: inserted, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return new MockDocSnap(inserted.id, mapKeys(inserted, snakeToCamel), table);
}

export async function deleteDoc(docRef) {
  const table = docRef.name;
  let q = supabase.from(table).delete();
  if (table === 'configuracion') {
    q = q.eq('key', docRef.id);
  } else if (table === 'usuarios' && docRef.id.length === 36 && !docRef.id.includes('-')) {
    q = q.eq('uid', docRef.id);
  } else {
    q = q.eq('id', docRef.id);
  }
  const { error } = await q;
  if (error) throw error;
}

export function onSnapshot(queryOrRef, onNext, onError) {
  let ref = queryOrRef;
  if (queryOrRef.type === 'query') {
    ref = queryOrRef.ref;
  }
  const table = ref.name;
  let active = true;
  // Control de concurrencia: solo la respuesta del fetch más reciente
  // puede emitirse. Una respuesta obsoleta jamás sobreescribe el estado.
  let runId = 0;
  let inFlight = false;
  let refetchQueued = false;
  
  const runFetch = async () => {
    if (!active) return;
    if (inFlight) {
      // Colapsa ráfagas de eventos en un único refetch al terminar el actual.
      refetchQueued = true;
      return;
    }
    inFlight = true;
    const currentRun = ++runId;
    try {
      const snap = await getDocs(queryOrRef);
      if (active && currentRun === runId) onNext(snap);
    } catch (err) {
      if (active && currentRun === runId && onError) onError(err);
    } finally {
      inFlight = false;
      if (active && refetchQueued) {
        refetchQueued = false;
        runFetch();
      }
    }
  };
  
  runFetch();
  
  const channel = supabase
    .channel(`${table}_changes`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      runFetch();
    })
    .subscribe();
    
  return () => {
    active = false;
    supabase.removeChannel(channel);
  };
}

// ==========================================
// MIGRATION & HELPERS UTILS
// ==========================================

export async function obtenerSiguienteId(coleccion, contadorDoc, prefijo) {
  const { data, error } = await supabase.rpc('obtener_siguiente_id', {
    p_coleccion: coleccion,
    p_contador_doc: contadorDoc,
    p_prefijo: prefijo
  });
  if (error) throw error;
  return data;
}

export async function syncUserToSupabase(user) {
  return true; // No-op, sync se maneja por trigger DB
}

export const PERMISOS_POR_ROL = {
  admin: {
    crearProductos: true,
    editarProductos: true,
    eliminarProductos: true,
    gestionarUsuarios: true,
    gestionarLlaves: true,
    configuracion: true
  },
  editor: {
    crearProductos: false,
    editarProductos: true,
    eliminarProductos: false,
    gestionarUsuarios: false,
    gestionarLlaves: false,
    configuracion: false
  }
};

export function permisosPorRol(rol) {
  return PERMISOS_POR_ROL[rol] || PERMISOS_POR_ROL['editor'];
}
