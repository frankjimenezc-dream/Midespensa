"use client";
import { useState, useEffect, useRef } from "react";

const STORAGE_KEY  = "pantry-products-v3";
const SHOPPING_KEY = "pantry-shopping-v2";
const CONSUMED_KEY = "pantry-consumed-v2";
const CATEGORIES = ["Lácteos","Carnes","Verduras","Frutas","Panadería","Conservas","Bebidas","Congelados","Otros"];
const CAT_ICONS  = {"Lácteos":"🥛","Carnes":"🥩","Verduras":"🥦","Frutas":"🍎","Panadería":"🍞","Conservas":"🥫","Bebidas":"🧃","Congelados":"🧊","Otros":"📦"};
const STATUS = {
  ok:      {label:"Vigente",            color:"bg-green-100 text-green-700",   dot:"bg-green-500",  border:"border-green-100"},
  soon:    {label:"Vence pronto",       color:"bg-yellow-100 text-yellow-700", dot:"bg-yellow-400", border:"border-yellow-100"},
  urgent:  {label:"¡Vence hoy/mañana!",color:"bg-orange-100 text-orange-700", dot:"bg-orange-500", border:"border-orange-100"},
  expired: {label:"Vencido",            color:"bg-red-100 text-red-700",       dot:"bg-red-500",    border:"border-red-100"},
  consumed:{label:"Consumido",          color:"bg-gray-100 text-gray-500",     dot:"bg-gray-400",   border:"border-gray-100"},
};

function getStatus(expiry) {
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiry); exp.setHours(0,0,0,0);
  const diff  = Math.round((exp - today) / 86400000);
  if (diff < 0)  return {key:"expired", days:diff};
  if (diff <= 2) return {key:"urgent",  days:diff};
  if (diff <= 7) return {key:"soon",    days:diff};
  return {key:"ok", days:diff};
}
function daysLabel(days) {
  if (days < 0)   return "Venció hace " + Math.abs(days) + " día" + (Math.abs(days)!==1?"s":"");
  if (days === 0) return "¡Vence hoy!";
  if (days === 1) return "¡Vence mañana!";
  return "Vence en " + days + " días";
}
function daysSince(date) {
  if (!date) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  return Math.round((today - d) / 86400000);
}
function toBase64(file) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function callClaude(prompt, image = null) {
  const body = { prompt };
  if (image) body.image = image;
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Error al llamar a la API");
  }
  const data = await res.json();
  return data.content;
}

const emptyForm = {name:"",category:"Otros",quantity:1,unit:"unidad",expiry:"",purchaseDate:""};
const SCAN_PROMPT = "Eres un asistente de despensa. Analiza esta boleta/factura de supermercado e identifica TODOS los productos alimenticios. Para cada producto retorna un objeto JSON con: name (string legible en español), category (una de: Lácteos, Carnes, Verduras, Frutas, Panadería, Conservas, Bebidas, Congelados, Otros), quantity (número), unit (unidad/kg/g/L/mL/caja/bolsa/paquete/lata), purchaseDate (YYYY-MM-DD, usa hoy " + new Date().toISOString().slice(0,10) + " si no aparece), expiry (YYYY-MM-DD estimada: lácteos +10d, carnes +4d, frutas/verduras +6d, conservas +365d, pan +4d, bebidas +180d, congelados +90d). Responde SOLO con un JSON array válido sin texto extra ni backticks. Si no hay productos alimenticios retorna [].";

function ReceiptScanModal({ onClose, onConfirmAll }) {
  const fileRef = useRef();
  const [step, setStep]             = useState("upload");
  const [preview, setPreview]       = useState(null);
  const [scanned, setScanned]       = useState([]);
  const [selected, setSelected]     = useState([]);
  const [editIdx, setEditIdx]       = useState(null);
  const [editForm, setEditForm]     = useState({});
  const [errMsg, setErrMsg]         = useState("");
  const [manualText, setManualText] = useState("");
  const [showManual, setShowManual] = useState(false);

  const processText = async (text) => {
    setStep("scanning");
    try {
      const raw = await callClaude(SCAN_PROMPT + "\n\nBOLETA:\n" + text);
      const clean = String(raw).replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      if (!Array.isArray(parsed) || parsed.length === 0) { setErrMsg("No se encontraron productos."); setStep("error"); return; }
      setScanned(parsed.map((p,i) => ({...p, _id:i})));
      setSelected(parsed.map((_,i) => i));
      setStep("preview");
    } catch(e) { setErrMsg("Error al procesar: " + (e && e.message ? e.message : "desconocido")); setStep("error"); }
  };

  const extractPDFText = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const bin = e.target.result; let out = "";
        const re = /\(([^)\\]|\\.){1,200}\)/g; let m;
        while ((m = re.exec(bin)) !== null) {
          const s = m[0].slice(1,-1).replace(/\\n/g,"\n").replace(/\\r/g,"").replace(/\\t/g," ").replace(/\\\\/g,"\\").replace(/[^\x20-\x7E\n]/g,"");
          if (s.trim().length > 1) out += s + " ";
        }
        resolve(out.trim());
      } catch { resolve(""); }
    };
    reader.onerror = () => resolve("");
    reader.readAsBinaryString(file);
  });

  const handleFile = async (file) => {
    if (!file) return;
    const isP = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setPreview(isP ? "pdf" : URL.createObjectURL(file));
    if (isP) {
      const text = await extractPDFText(file);
      if (text.length > 80) { await processText(text); }
      else { setShowManual(true); setStep("upload"); }
    } else {
      setStep("scanning");
      try {
        const b64 = await toBase64(file);
        const mt  = file.type || "image/jpeg";
        const raw = await callClaude(SCAN_PROMPT, { data: b64, mediaType: mt });
        const clean = String(raw).replace(/```json|```/g,"").trim();
        const parsed = JSON.parse(clean);
        if (!Array.isArray(parsed) || parsed.length === 0) { setErrMsg("No se encontraron productos en la imagen."); setStep("error"); return; }
        setScanned(parsed.map((p,i) => ({...p, _id:i})));
        setSelected(parsed.map((_,i) => i));
        setStep("preview");
      } catch(e) { setErrMsg("Error: " + (e && e.message ? e.message : "desconocido")); setStep("error"); }
    }
  };

  const toggleSelect = (i) => setSelected(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev,i]);
  const startEdit = (i) => { setEditIdx(i); setEditForm({...scanned[i]}); };
  const saveEdit  = () => { setScanned(prev => prev.map((p,i) => i===editIdx ? {...editForm,_id:i} : p)); setEditIdx(null); };
  const handleConfirm = () => {
    const toAdd = scanned.filter(p => selected.includes(p._id)).map(p => ({...p, id: Date.now()+Math.random()}));
    onConfirmAll(toAdd); onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-800">📷 Escanear boleta</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step==="upload" && "Sube una foto o PDF de tu boleta"}
              {step==="scanning" && "Analizando con IA..."}
              {step==="preview" && (scanned.length + " producto" + (scanned.length!==1?"s":"") + " detectado" + (scanned.length!==1?"s":""))}
              {step==="error" && "No se pudo procesar"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {step==="upload" && (
            <div className="space-y-4">
              <button onClick={() => fileRef.current.click()} className="w-full border-2 border-dashed border-gray-200 hover:border-emerald-400 rounded-2xl py-10 flex flex-col items-center gap-3 transition-colors">
                <div className="flex gap-3 text-4xl">🧾📄</div>
                <p className="text-sm font-medium text-gray-600">Toca para seleccionar archivo</p>
                <p className="text-xs text-gray-400">Foto de boleta o PDF</p>
              </button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => e.target.files[0] && handleFile(e.target.files[0])}/>
              <button onClick={() => setShowManual(v=>!v)} className="w-full text-xs text-emerald-600 hover:underline text-center py-1">
                {showManual ? "▲ Ocultar entrada manual" : "¿No funciona el PDF? Pega el texto aquí ▼"}
              </button>
              {showManual && (
                <div className="space-y-2">
                  <textarea value={manualText} onChange={e=>setManualText(e.target.value)} placeholder="Ej: LECHE 1L 4.50&#10;MANZANA 0.5kg 3.20" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 resize-none" rows={6}/>
                  <button onClick={() => manualText.trim() && processText(manualText)} disabled={!manualText.trim()} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-sm font-medium py-2.5 rounded-xl transition-colors">Analizar texto</button>
                </div>
              )}
            </div>
          )}
          {step==="scanning" && (
            <div className="flex flex-col items-center gap-5 py-10">
              {preview && preview!=="pdf" && <img src={preview} className="w-32 h-40 object-cover rounded-xl border border-gray-200 shadow-sm opacity-70" alt="preview"/>}
              <div className="flex gap-1.5">{[0,1,2].map(i=><div key={i} className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-bounce" style={{animationDelay:i*0.15+"s"}}/>)}</div>
              <p className="text-sm font-medium text-gray-600">Detectando productos...</p>
            </div>
          )}
          {step==="preview" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <button onClick={() => setSelected(selected.length===scanned.length ? [] : scanned.map(p=>p._id))} className="text-xs text-emerald-600 hover:underline font-medium">
                  {selected.length===scanned.length ? "Deseleccionar todo" : "Seleccionar todo"}
                </button>
                <span className="text-xs text-gray-400">{selected.length} de {scanned.length} seleccionados</span>
              </div>
              {scanned.map((p,i) => (
                <div key={p._id} id={"scan-item-"+i} className={"rounded-xl border transition-all " + (selected.includes(p._id) ? "border-emerald-300 bg-emerald-50" : "border-gray-100 bg-white opacity-60")}>
                  {editIdx===i ? (
                    <div className="p-3 space-y-2">
                      <input value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-400"/>
                      <div className="flex gap-2">
                        <button onClick={()=>setEditIdx(null)} className="flex-1 border border-gray-200 text-gray-500 text-xs py-1.5 rounded-lg">Cancelar</button>
                        <button onClick={saveEdit} className="flex-1 bg-emerald-600 text-white text-xs py-1.5 rounded-lg">Guardar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-3">
                      <button onClick={()=>toggleSelect(p._id)} className={"w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center " + (selected.includes(p._id) ? "bg-emerald-500 border-emerald-500" : "border-gray-300")}>
                        {selected.includes(p._id) && <span className="text-white text-xs">✓</span>}
                      </button>
                      <span className="text-xl">{CAT_ICONS[p.category]||"📦"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.quantity} {p.unit} · {p.category}</p>
                      </div>
                      <button onClick={()=>startEdit(i)} className="text-gray-400 hover:text-emerald-600 p-1">✏️</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {step==="error" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <span className="text-5xl">😕</span>
              <p className="text-sm text-gray-600 text-center">{errMsg}</p>
              <button onClick={()=>{setStep("upload");setPreview(null);setShowManual(true);}} className="bg-emerald-600 text-white text-sm px-5 py-2 rounded-lg">Intentar de nuevo</button>
            </div>
          )}
        </div>
        {step==="preview" && (
          <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex gap-3">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl">Cancelar</button>
            <button onClick={handleConfirm} disabled={selected.length===0} className="flex-1 bg-emerald-600 disabled:bg-gray-300 text-white text-sm font-medium py-2.5 rounded-xl">
              Agregar {selected.length} producto{selected.length!==1?"s":""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniCard({p, consumed, onToggleConsumed, onAddShopping}) {
  const isC=consumed.has(p.id), s=isC?{key:"consumed",days:null}:getStatus(p.expiry), st=STATUS[s.key], dsp=daysSince(p.purchaseDate);
  return (
    <div className={"bg-white rounded-xl border shadow-sm px-4 py-3 flex items-start gap-3 " + st.border}>
      <div className={"w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 " + st.dot}/>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span>{CAT_ICONS[p.category]}</span>
          <span className="font-medium text-sm text-gray-800">{p.name}</span>
          <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + st.color}>{st.label}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-gray-500">
          <span>📦 {p.quantity} {p.unit}</span>
          {!isC && <span>{daysLabel(s.days)}</span>}
          {dsp!==null && <span>🛍️ Hace {dsp} día{dsp!==1?"s":""}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1 items-end flex-shrink-0">
        {isC
          ? <button onClick={()=>onToggleConsumed(p.id)} className="text-xs bg-gray-100 hover:bg-yellow-100 text-gray-600 px-2 py-0.5 rounded-full">↩️ Extornar</button>
          : <><button onClick={()=>onToggleConsumed(p.id)} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">✅ Consumido</button>
             <button onClick={()=>onAddShopping(p.name)} className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">🛒 Compras</button></>
        }
      </div>
    </div>
  );
}

function ProductCard({p, consumed, onEdit, onDelete, onToggleConsumed, onAddShopping}) {
  const [expanded, setExpanded] = useState(false);
  const isC=consumed.has(p.id), s=isC?{key:"consumed",days:null}:getStatus(p.expiry), st=STATUS[s.key], dsp=daysSince(p.purchaseDate);
  return (
    <div className={"bg-white rounded-xl border shadow-sm overflow-hidden " + st.border + (isC?" opacity-70":"")}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={"w-2.5 h-2.5 rounded-full flex-shrink-0 " + st.dot}/>
        <span className="flex-shrink-0">{CAT_ICONS[p.category]}</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-800 text-sm truncate">{p.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-500">{p.quantity} {p.unit}</span>
            <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + st.color}>{!isC ? daysLabel(s.days) : st.label}</span>
          </div>
        </div>
        <button onClick={()=>setExpanded(v=>!v)} className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold text-sm flex-shrink-0">
          {expanded ? "−" : "+"}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2.5 bg-gray-50">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>🏷️ {p.category}</span>
            {dsp!==null && <span>🛍️ Comprado hace {dsp} día{dsp!==1?"s":""}</span>}
            {p.purchaseDate && <span>📅 Compra: {p.purchaseDate}</span>}
            <span>⏳ Vence: {p.expiry}</span>
            {!isC && <span className={"font-medium " + (s.key==="expired"?"text-red-500":s.key==="urgent"?"text-orange-500":s.key==="soon"?"text-yellow-600":"text-green-600")}>{daysLabel(s.days)}</span>}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {isC
                ? <button onClick={()=>onToggleConsumed(p.id)} className="text-xs bg-gray-200 hover:bg-yellow-100 text-gray-600 px-3 py-1 rounded-full">↩️ Extornar</button>
                : <><button onClick={()=>onToggleConsumed(p.id)} className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full">✅ Consumido</button>
                   <button onClick={()=>onAddShopping(p.name)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1 rounded-full ml-1">🛒</button></>
              }
            </div>
            <div className="flex gap-1">
              <button onClick={()=>onEdit(p)} className="text-gray-400 hover:text-emerald-600 p-1.5 rounded-lg hover:bg-emerald-50">✏️</button>
              <button onClick={()=>onDelete(p.id)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50">🗑️</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DrillModal({title, subtitle, items, consumed, onToggleConsumed, onAddShopping, onClose, onGoToTab, targetTab, targetFilter}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div><h2 className="text-lg font-bold text-gray-800">{title}</h2>{subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {items.length===0 ? <p className="text-center text-gray-400 py-8 text-sm">No hay productos aquí</p>
            : items.map(p=><MiniCard key={p.id} p={p} consumed={consumed} onToggleConsumed={onToggleConsumed} onAddShopping={onAddShopping}/>)}
        </div>
        <div className="p-4 border-t border-gray-100">
          <button onClick={()=>{onGoToTab(targetTab,targetFilter);onClose();}} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 rounded-lg">Ver listado completo →</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [products,       setProducts]       = useState([]);
  const [shoppingList,   setShoppingList]   = useState([]);
  const [consumed,       setConsumed]       = useState(new Set());
  const [form,           setForm]           = useState(emptyForm);
  const [showForm,       setShowForm]       = useState(false);
  const [showScan,       setShowScan]       = useState(false);
  const [editId,         setEditId]         = useState(null);
  const [tab,            setTab]            = useState("dashboard");
  const [pantryFilter,   setPantryFilter]   = useState("all");
  const [histFilter,     setHistFilter]     = useState("all");
  const [histCat,        setHistCat]        = useState("all");
  const [catFilter,      setCatFilter]      = useState("all");
  const [search,         setSearch]         = useState("");
  const [histSearch,     setHistSearch]     = useState("");
  const [dismissed,      setDismissed]      = useState(new Set());
  const [newShopItem,    setNewShopItem]    = useState("");
  const [loaded,         setLoaded]         = useState(false);
  const [drillModal,     setDrillModal]     = useState(null);
  const [toast,          setToast]          = useState(null);
  const [recipes,        setRecipes]        = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError,   setRecipesError]   = useState("");
  const [expandedRecipe, setExpandedRecipe] = useState(null);

  useEffect(() => {
    try {
      const r1 = localStorage.getItem(STORAGE_KEY);  if(r1) setProducts(JSON.parse(r1));
      const r2 = localStorage.getItem(SHOPPING_KEY); if(r2) setShoppingList(JSON.parse(r2));
      const r3 = localStorage.getItem(CONSUMED_KEY); if(r3) setConsumed(new Set(JSON.parse(r3)));
    } catch(_) {}
    setLoaded(true);
  }, []);

  useEffect(() => { if(loaded) localStorage.setItem(STORAGE_KEY,  JSON.stringify(products)); },      [products,  loaded]);
  useEffect(() => { if(loaded) localStorage.setItem(SHOPPING_KEY, JSON.stringify(shoppingList)); },  [shoppingList, loaded]);
  useEffect(() => { if(loaded) localStorage.setItem(CONSUMED_KEY, JSON.stringify([...consumed])); }, [consumed,  loaded]);

  const showToast = (msg) => { setToast(msg); setTimeout(()=>setToast(null),3000); };

  const active  = products.filter(p=>!consumed.has(p.id));
  const expired = active.filter(p=>getStatus(p.expiry).key==="expired");
  const urgent  = active.filter(p=>getStatus(p.expiry).key==="urgent");
  const soon    = active.filter(p=>getStatus(p.expiry).key==="soon");
  const okList  = active.filter(p=>getStatus(p.expiry).key==="ok");
  const alerts  = [...expired,...urgent].filter(p=>!dismissed.has(p.id));
  const shopPending = shoppingList.filter(i=>!i.done).length;
  const catBreakdown = CATEGORIES.map(c=>({cat:c,total:active.filter(p=>p.category===c).length,expiring:active.filter(p=>p.category===c&&["urgent","expired","soon"].includes(getStatus(p.expiry).key)).length})).filter(c=>c.total>0).sort((a,b)=>b.expiring-a.expiring);

  const handleSubmit   = () => { if(!form.name.trim()||!form.expiry) return; if(editId){setProducts(prev=>prev.map(p=>p.id===editId?{...p,...form}:p));setEditId(null);}else setProducts(prev=>[...prev,{...form,id:Date.now()}]); setForm(emptyForm); setShowForm(false); };
  const handleEdit     = (p) => { setForm({name:p.name,category:p.category,quantity:p.quantity,unit:p.unit,expiry:p.expiry,purchaseDate:p.purchaseDate||""}); setEditId(p.id); setShowForm(true); };
  const handleDelete   = (id) => setProducts(prev=>prev.filter(p=>p.id!==id));
  const toggleConsumed = (id) => setConsumed(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const addToShopping  = (name) => { if(shoppingList.some(i=>i.name.toLowerCase()===name.toLowerCase())) return; setShoppingList(prev=>[...prev,{id:Date.now(),name,done:false,fromPantry:true}]); };
  const addShopItem    = () => { if(!newShopItem.trim()) return; setShoppingList(prev=>[...prev,{id:Date.now(),name:newShopItem.trim(),done:false}]); setNewShopItem(""); };
  const toggleShopDone = (id) => setShoppingList(prev=>prev.map(i=>i.id===id?{...i,done:!i.done}:i));
  const deleteShopItem = (id) => setShoppingList(prev=>prev.filter(i=>i.id!==id));
  const clearDone      = ()   => setShoppingList(prev=>prev.filter(i=>!i.done));
  const goToTab        = (t,f) => { setTab(t); if(f&&t==="pantry") setPantryFilter(f); if(f&&t==="history") setHistFilter(f); };
  const handleScanConfirm = (items) => { setProducts(prev=>[...prev,...items]); showToast("✅ "+items.length+" producto"+(items.length!==1?"s":"")+" agregado"+(items.length!==1?"s":"")+" desde la boleta"); };

  const generateRecipes = async () => {
    if(active.length===0) return;
    setRecipesLoading(true); setRecipesError(""); setRecipes([]); setExpandedRecipe(null);
    try {
      const expiringNames = [...expired,...urgent,...soon].map(p=>p.name);
      const sorted = [...active].sort((a,b)=>new Date(a.expiry)-new Date(b.expiry));
      const ingredientList = sorted.map(p=>p.name+" ("+p.quantity+" "+p.unit+(expiringNames.includes(p.name)?" ⚠️POR VENCER":"")+")" ).join(", ");
      const prompt = "Eres un chef creativo latinoamericano. Con estos ingredientes genera EXACTAMENTE 3 recetas variadas.\n\nINGREDIENTES:\n"+ingredientList+"\n\nResponde SOLO con JSON array de 3 objetos sin texto extra:\n[{\"title\":\"nombre\",\"emoji\":\"emoji\",\"time\":\"20\",\"difficulty\":\"Fácil\",\"usesExpiring\":true,\"ingredientsAvailable\":[\"ing1\"],\"ingredientsMissing\":[\"ing2\"],\"steps\":[\"Paso 1...\",\"Paso 2...\"]}]";
      const raw = await callClaude(prompt);
      const clean = String(raw).replace(/```json|```/g,"").trim();
      const parsed = JSON.parse(clean);
      if(!Array.isArray(parsed)||parsed.length===0) throw new Error("Sin recetas");
      setRecipes(parsed);
    } catch(e) { setRecipesError("No se pudieron generar recetas. Intenta nuevamente."); }
    finally { setRecipesLoading(false); }
  };

  const activeCats = [...new Set(active.map(p=>p.category))];
  const pantryList = active.filter(p=>{const s=getStatus(p.expiry).key;if(pantryFilter==="urgent")return s==="urgent"||s==="expired";if(pantryFilter==="soon")return s==="soon";if(pantryFilter==="ok")return s==="ok";return true;}).filter(p=>catFilter==="all"||p.category===catFilter).filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>new Date(a.expiry)-new Date(b.expiry));
  const pantryCount = {all:active.length,urgent:urgent.length+expired.length,soon:soon.length,ok:okList.length};
  const allCats = [...new Set(products.map(p=>p.category))];
  const historyList = products.filter(p=>{const isC=consumed.has(p.id),sk=getStatus(p.expiry).key;if(histFilter==="consumed")return isC;if(histFilter==="expired")return!isC&&sk==="expired";if(histFilter==="urgent")return!isC&&sk==="urgent";if(histFilter==="soon")return!isC&&sk==="soon";if(histFilter==="ok")return!isC&&sk==="ok";return true;}).filter(p=>histCat==="all"||p.category===histCat).filter(p=>p.name.toLowerCase().includes(histSearch.toLowerCase())).sort((a,b)=>new Date(a.expiry)-new Date(b.expiry));
  const histCounts = {all:products.length,ok:okList.length,soon:soon.length,urgent:urgent.length,expired:expired.length,consumed:consumed.size};

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-24">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white text-sm px-5 py-3 rounded-full shadow-xl">{toast}</div>}
      <div className="bg-white border-b border-gray-100 px-4 py-3 sticky top-0 z-20 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">🛒 Mi Despensa</h1>
            <p className="text-xs text-gray-400">{products.length} productos · {shopPending} por comprar</p>
          </div>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {tab==="dashboard" && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Resumen ejecutivo</p>
            <div className="grid grid-cols-1 gap-3">
              <button onClick={()=>setDrillModal({title:"Total en despensa",subtitle:active.length+" productos activos",items:active.sort((a,b)=>new Date(a.expiry)-new Date(b.expiry)),targetTab:"pantry",targetFilter:"all"})} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-5 hover:shadow-md hover:border-emerald-200 transition-all text-left w-full">
                <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center text-3xl flex-shrink-0">🥫</div>
                <div className="flex-1"><p className="text-4xl font-bold text-gray-800">{active.length}</p><p className="text-sm font-medium text-gray-600 mt-0.5">Total en despensa</p><p className="text-xs text-gray-400 mt-1">{consumed.size} consumidos · {products.length} histórico</p></div>
                <span className="text-gray-300 text-xl">›</span>
              </button>
              <button onClick={()=>setDrillModal({title:"Vencen pronto",subtitle:"Próximos 7 días",items:[...urgent,...soon].sort((a,b)=>new Date(a.expiry)-new Date(b.expiry)),targetTab:"pantry",targetFilter:"soon"})} className={"bg-white rounded-2xl border shadow-sm p-5 flex items-center gap-5 hover:shadow-md transition-all text-left w-full "+(soon.length+urgent.length>0?"border-yellow-200":"border-gray-100")}>
                <div className={"w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0 "+(soon.length+urgent.length>0?"bg-yellow-50":"bg-gray-50")}>⏳</div>
                <div className="flex-1"><p className={"text-4xl font-bold "+(soon.length+urgent.length>0?"text-yellow-600":"text-gray-400")}>{soon.length+urgent.length}</p><p className="text-sm font-medium text-gray-600 mt-0.5">Vencen en 7 días</p>
                  <div className="flex gap-3 mt-1">{urgent.length>0&&<span className="text-xs text-orange-500 font-medium">🟠 {urgent.length} urgente{urgent.length!==1?"s":""}</span>}{soon.length>0&&<span className="text-xs text-yellow-500 font-medium">🟡 {soon.length} en la semana</span>}{soon.length+urgent.length===0&&<span className="text-xs text-gray-400">Todo bajo control ✓</span>}</div>
                </div><span className="text-gray-300 text-xl">›</span>
              </button>
              <button onClick={()=>setDrillModal({title:"Productos vencidos",subtitle:"Requieren atención inmediata",items:expired,targetTab:"history",targetFilter:"expired"})} className={"bg-white rounded-2xl border shadow-sm p-5 flex items-center gap-5 hover:shadow-md transition-all text-left w-full "+(expired.length>0?"border-red-200":"border-gray-100")}>
                <div className={"w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0 "+(expired.length>0?"bg-red-50":"bg-gray-50")}>🚨</div>
                <div className="flex-1"><p className={"text-4xl font-bold "+(expired.length>0?"text-red-600":"text-gray-400")}>{expired.length}</p><p className="text-sm font-medium text-gray-600 mt-0.5">Productos vencidos</p><p className="text-xs mt-1">{expired.length>0?<span className="text-red-400">⚠️ Revisar y descartar</span>:<span className="text-gray-400">Sin productos vencidos ✓</span>}</p></div>
                <span className="text-gray-300 text-xl">›</span>
              </button>
            </div>
            {catBreakdown.length>0&&(
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Por categoría</p>
                <div className="space-y-2.5">
                  {catBreakdown.map(c=>{const pct=c.total>0?Math.round((c.expiring/c.total)*100):0;return(
                    <button key={c.cat} onClick={()=>{goToTab("pantry","all");setCatFilter(c.cat);}} className="w-full flex items-center gap-3 hover:bg-gray-50 rounded-lg px-1 py-1 transition-colors">
                      <span className="text-xl w-7 text-center flex-shrink-0">{CAT_ICONS[c.cat]}</span>
                      <div className="flex-1 min-w-0"><div className="flex justify-between items-center mb-1"><span className="text-sm text-gray-700 font-medium">{c.cat}</span><span className="text-xs text-gray-400">{c.total} prod.</span></div><div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={"h-full rounded-full "+(pct>0?"bg-yellow-400":"bg-green-400")} style={{width:Math.max(pct,4)+"%"}}/></div></div>
                      {c.expiring>0&&<span className="text-xs text-orange-500 font-semibold flex-shrink-0">{c.expiring} ⚠️</span>}
                      <span className="text-gray-300 text-sm flex-shrink-0">›</span>
                    </button>
                  );})}
                </div>
              </div>
            )}
            {products.length===0&&<div className="text-center py-12 text-gray-400"><div className="text-6xl mb-3">🥫</div><p className="text-sm font-medium">Tu despensa está vacía</p><p className="text-xs mt-1">Ve a <strong>Compras</strong> para agregar productos</p></div>}
          </div>
        )}
        {tab==="pantry" && (
          <>
            {alerts.length>0&&(<div className="bg-red-50 border border-red-200 rounded-xl p-4"><div className="flex items-center justify-between mb-2"><p className="text-sm font-semibold text-red-700">⚠️ {alerts.length} producto{alerts.length!==1?"s":""} requieren atención</p><button onClick={()=>setDismissed(new Set(alerts.map(a=>a.id)))} className="text-xs text-red-400 hover:underline">Descartar</button></div><ul className="space-y-1.5">{alerts.map(p=>{const s=getStatus(p.expiry);return(<li key={p.id} className="flex items-center justify-between text-sm text-red-700"><span>• <strong>{p.name}</strong> — {daysLabel(s.days)}</span><button onClick={()=>addToShopping(p.name)} className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full ml-2">+ Compras</button></li>);})}</ul></div>)}
            <input type="text" placeholder="🔍 Buscar producto..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 bg-white"/>
            <div className="flex gap-2 overflow-x-auto pb-1">{[{key:"all",label:"Todos"},{key:"urgent",label:"🔴 Urgente"},{key:"soon",label:"🟡 Pronto"},{key:"ok",label:"🟢 Vigentes"}].map(t=>(<button key={t.key} onClick={()=>setPantryFilter(t.key)} className={"whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full border transition-colors "+(pantryFilter===t.key?"bg-emerald-600 text-white border-emerald-600":"bg-white text-gray-600 border-gray-200")}>{t.label} ({pantryCount[t.key]})</button>))}</div>
            {activeCats.length>1&&<div className="flex gap-2 overflow-x-auto pb-1"><button onClick={()=>setCatFilter("all")} className={"whitespace-nowrap text-xs px-3 py-1 rounded-full border "+(catFilter==="all"?"bg-gray-700 text-white border-gray-700":"bg-white text-gray-500 border-gray-200")}>Todas</button>{activeCats.map(c=>(<button key={c} onClick={()=>setCatFilter(c)} className={"whitespace-nowrap text-xs px-3 py-1 rounded-full border "+(catFilter===c?"bg-gray-700 text-white border-gray-700":"bg-white text-gray-500 border-gray-200")}>{CAT_ICONS[c]} {c}</button>))}</div>}
            {pantryList.length===0?<div className="text-center py-16 text-gray-400"><div className="text-5xl mb-3">🥫</div><p className="text-sm">No hay productos aquí</p></div>:<div className="space-y-2">{pantryList.map(p=><ProductCard key={p.id} p={p} consumed={consumed} onEdit={handleEdit} onDelete={handleDelete} onToggleConsumed={toggleConsumed} onAddShopping={addToShopping}/>)}</div>}
          </>
        )}
        {tab==="recipes" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-sm font-semibold text-gray-700 mb-1">👨‍🍳 ¿Qué puedo cocinar hoy?</p>
              <p className="text-xs text-gray-400 mb-4">La IA sugerirá 3 recetas priorizando los ingredientes por vencer.</p>
              <button onClick={generateRecipes} disabled={recipesLoading||active.length===0} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-sm font-semibold py-3 rounded-xl flex items-center justify-center gap-2">
                {recipesLoading ? <><div className="flex gap-1">{[0,1,2].map(i=><div key={i} className="w-2 h-2 bg-white rounded-full animate-bounce" style={{animationDelay:i*0.15+"s"}}/>)}</div>Generando...</> : <><span>✨</span>Generar recetas con mi despensa</>}
              </button>
            </div>
            {recipesError&&<div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3"><p className="text-sm text-red-600">{recipesError}</p></div>}
            {recipes.map((r,i)=>(
              <div key={i} className={"bg-white rounded-2xl border shadow-sm overflow-hidden "+(r.usesExpiring?"border-orange-200":"border-gray-100")}>
                <div className="px-4 py-4 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-3xl flex-shrink-0">{r.emoji||"🍽️"}</span>
                    <div className="min-w-0">
                      <h3 className="font-bold text-gray-800 text-sm">{r.title}</h3>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-gray-500">⏱️ {r.time} min</span>
                        <span className={"text-xs font-medium px-2 py-0.5 rounded-full "+(r.difficulty==="Fácil"?"bg-green-100 text-green-700":"bg-yellow-100 text-yellow-700")}>{r.difficulty}</span>
                        <span className="text-xs text-emerald-600">✅ {r.ingredientsAvailable?.length||0} tienes</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={()=>setExpandedRecipe(expandedRecipe===i?null:i)} className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 font-bold text-sm flex-shrink-0">{expandedRecipe===i?"−":"+"}</button>
                </div>
                {expandedRecipe===i&&(
                  <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50">
                    <ol className="space-y-2">{(r.steps||[]).map((step,j)=>(<li key={j} className="flex items-start gap-2.5"><span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold flex-shrink-0 mt-0.5">{j+1}</span><p className="text-xs text-gray-700 leading-relaxed">{step}</p></li>))}</ol>
                    {r.ingredientsMissing?.length>0&&<button onClick={()=>{r.ingredientsMissing.forEach(ing=>addToShopping(ing));showToast("🛒 Ingredientes agregados a tu lista");}} className="w-full border border-emerald-300 text-emerald-700 text-xs font-medium py-2 rounded-xl">+ Agregar ingredientes faltantes a lista de compras</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {tab==="history" && (
          <>
            <input type="text" placeholder="🔍 Buscar en historial..." value={histSearch} onChange={e=>setHistSearch(e.target.value)} className="w-full border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 bg-white"/>
            <div className="flex gap-2 overflow-x-auto pb-1">{[{key:"all",label:"Todos"},{key:"ok",label:"🟢 Vigentes"},{key:"soon",label:"🟡 Pronto"},{key:"urgent",label:"🟠 Urgente"},{key:"expired",label:"🔴 Vencidos"},{key:"consumed",label:"✅ Consumidos"}].map(t=>(<button key={t.key} onClick={()=>setHistFilter(t.key)} className={"whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full border "+(histFilter===t.key?"bg-gray-700 text-white border-gray-700":"bg-white text-gray-600 border-gray-200")}>{t.label} ({histCounts[t.key]})</button>))}</div>
            {allCats.length>1&&<div className="flex gap-2 overflow-x-auto pb-1"><button onClick={()=>setHistCat("all")} className={"whitespace-nowrap text-xs px-3 py-1 rounded-full border "+(histCat==="all"?"bg-gray-700 text-white border-gray-700":"bg-white text-gray-500 border-gray-200")}>Todas</button>{allCats.map(c=>(<button key={c} onClick={()=>setHistCat(c)} className={"whitespace-nowrap text-xs px-3 py-1 rounded-full border "+(histCat===c?"bg-gray-700 text-white border-gray-700":"bg-white text-gray-500 border-gray-200")}>{CAT_ICONS[c]} {c}</button>))}</div>}
            <div className="grid grid-cols-3 gap-2">{[{label:"Total",val:histCounts.all,bg:"bg-gray-100",text:"text-gray-700"},{label:"Vigentes",val:histCounts.ok,bg:"bg-green-50",text:"text-green-700"},{label:"Vencidos",val:histCounts.expired,bg:"bg-red-50",text:"text-red-700"},{label:"Urgente",val:histCounts.urgent,bg:"bg-orange-50",text:"text-orange-700"},{label:"Pronto",val:histCounts.soon,bg:"bg-yellow-50",text:"text-yellow-700"},{label:"Consumidos",val:histCounts.consumed,bg:"bg-emerald-50",text:"text-emerald-700"}].map(s=>(<div key={s.label} className={s.bg+" rounded-lg p-2 text-center"}><p className={"text-lg font-bold "+s.text}>{s.val}</p><p className="text-xs text-gray-500">{s.label}</p></div>))}</div>
            {historyList.length===0?<div className="text-center py-16 text-gray-400"><div className="text-5xl mb-3">📋</div><p className="text-sm">No hay productos en esta vista</p></div>:<div className="space-y-2">{historyList.map(p=><ProductCard key={p.id} p={p} consumed={consumed} onEdit={handleEdit} onDelete={handleDelete} onToggleConsumed={toggleConsumed} onAddShopping={addToShopping}/>)}</div>}
          </>
        )}
        {tab==="shopping" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={()=>setShowScan(true)} className="bg-white hover:bg-gray-50 border border-gray-100 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                <span className="text-2xl">📷</span>
                <div className="text-left"><p className="text-sm font-semibold text-gray-700">Escanear boleta</p><p className="text-xs text-gray-400">Foto o PDF</p></div>
              </button>
              <button onClick={()=>{setShowForm(true);setEditId(null);setForm(emptyForm);}} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl p-4 flex items-center gap-3">
                <span className="text-2xl">➕</span>
                <div className="text-left"><p className="text-sm font-semibold">Agregar</p><p className="text-xs opacity-75">Nuevo producto</p></div>
              </button>
            </div>
            <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold pt-1">Lista de compras</p>
            <div className="flex gap-2">
              <input type="text" placeholder="Agregar ítem..." value={newShopItem} onChange={e=>setNewShopItem(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addShopItem()} className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 bg-white"/>
              <button onClick={addShopItem} disabled={!newShopItem.trim()} className="bg-emerald-600 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Agregar</button>
            </div>
            {shoppingList.filter(i=>!i.done).length>0&&(<div className="space-y-2"><p className="text-xs font-semibold text-gray-500 uppercase">Por comprar ({shoppingList.filter(i=>!i.done).length})</p>{shoppingList.filter(i=>!i.done).map(item=>(<div key={item.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3"><button onClick={()=>toggleShopDone(item.id)} className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-emerald-500 flex-shrink-0"/><span className="flex-1 text-sm text-gray-800">{item.fromPantry&&<span className="text-xs text-orange-500 mr-1">⚠️</span>}{item.name}</span><button onClick={()=>deleteShopItem(item.id)} className="text-gray-300 hover:text-red-400">✕</button></div>))}</div>)}
            {shoppingList.filter(i=>i.done).length>0&&(<div className="space-y-2"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-gray-400 uppercase">Comprado ({shoppingList.filter(i=>i.done).length})</p><button onClick={clearDone} className="text-xs text-gray-400 hover:text-red-500">Limpiar ✕</button></div>{shoppingList.filter(i=>i.done).map(item=>(<div key={item.id} className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3"><button onClick={()=>toggleShopDone(item.id)} className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0"><span className="text-white text-xs">✓</span></button><span className="flex-1 text-sm text-gray-400 line-through">{item.name}</span><button onClick={()=>deleteShopItem(item.id)} className="text-gray-300 hover:text-red-400">✕</button></div>))}</div>)}
            {shoppingList.length===0&&<div className="text-center py-12 text-gray-400"><div className="text-5xl mb-3">🛍️</div><p className="text-sm">Tu lista de compras está vacía</p></div>}
          </>
        )}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 shadow-lg z-20">
        <div className="max-w-2xl mx-auto flex">
          {[{key:"dashboard",icon:"📊",label:"Resumen",badge:0},{key:"pantry",icon:"🥫",label:"Despensa",badge:expired.length+urgent.length},{key:"recipes",icon:"👨‍🍳",label:"Recetas",badge:0},{key:"history",icon:"📋",label:"Historial",badge:0},{key:"shopping",icon:"🛒",label:"Compras",badge:shopPending}].map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} className={"flex-1 py-3 flex flex-col items-center gap-0.5 text-xs font-medium relative "+(tab===t.key?"text-emerald-600":"text-gray-400")}>
              <span className="text-xl">{t.icon}</span><span>{t.label}</span>
              {t.badge>0&&<span className="absolute top-2 ml-5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>
      {showScan&&<ReceiptScanModal onClose={()=>setShowScan(false)} onConfirmAll={handleScanConfirm}/>}
      {drillModal&&<DrillModal {...drillModal} consumed={consumed} onToggleConsumed={toggleConsumed} onAddShopping={addToShopping} onClose={()=>setDrillModal(null)} onGoToTab={goToTab}/>}
      {showForm&&(
        <div className="fixed inset-0 bg-black bg-opacity-40 z-30 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h2 className="text-lg font-bold text-gray-800">{editId?"Editar producto":"Agregar producto"}</h2>
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">Nombre *</label><input type="text" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Ej: Leche descremada" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"/></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600 mb-1 block">Cantidad</label><input type="number" min="1" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"/></div>
                <div><label className="text-xs font-medium text-gray-600 mb-1 block">Unidad</label><select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400">{["unidad","kg","g","L","mL","caja","bolsa","paquete","lata"].map(u=><option key={u}>{u}</option>)}</select></div>
              </div>
              <div><label className="text-xs font-medium text-gray-600 mb-1 block">Categoría</label><select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400">{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-gray-600 mb-1 block">Fecha de compra</label><input type="date" value={form.purchaseDate} onChange={e=>setForm(f=>({...f,purchaseDate:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"/></div>
                <div><label className="text-xs font-medium text-gray-600 mb-1 block">Vencimiento *</label><input type="date" value={form.expiry} onChange={e=>setForm(f=>({...f,expiry:e.target.value}))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"/></div>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={()=>{setShowForm(false);setEditId(null);setForm(emptyForm);}} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2 rounded-lg">Cancelar</button>
              <button onClick={handleSubmit} disabled={!form.name.trim()||!form.expiry} className="flex-1 bg-emerald-600 disabled:bg-gray-300 text-white text-sm font-medium py-2 rounded-lg">{editId?"Guardar cambios":"Agregar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
