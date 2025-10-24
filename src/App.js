// App.jsx
import { BrowserRouter as Router, Routes, Route, useParams } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/** ---------------- Supabase client ---------------- */
const supabaseUrl = "https://begfjxlvjaubnizkvruw.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJlZ2ZqeGx2amF1Ym5pemt2cnV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYwNjM0MzcsImV4cCI6MjA3MTYzOTQzN30.P6s1vWqAhXaNclfQw1NQ8Sj974uQJxAmoYG9mPvpKSQ";
const supabase = createClient(supabaseUrl, supabaseKey);

/** ---------------- Helpers ---------------- */
const safeParse = (val) => {
  if (!val) return [];
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return []; }
  }
  if (Array.isArray(val)) return val;
  return [];
};

const toUpperIfString = (v) => (typeof v === "string" ? v.toUpperCase() : v);
const num = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const cleaned = String(v).replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

const normalizeRows = (inv) => {
  const productname = safeParse(inv.productname);
  const description = safeParse(inv.description);
  const quantity = safeParse(inv.quantity);
  const units = safeParse(inv.units);
  const rate = safeParse(inv.rate);
  const maxLen = Math.max(productname.length, description.length, quantity.length, units.length, rate.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const row = {
      productname: productname[i] ?? "",
      description: description[i] ?? "",
      quantity: quantity[i] ?? "",
      units: units[i] ?? "",
      rate: rate[i] ?? "",
    };
    const hasAny = row.productname || row.description || row.quantity || row.units || row.rate;
    if (hasAny) rows.push(row);
  }
  return rows;
};

/** ---------------- Invoice Page ---------------- */
function InvoicePage() {
  const { phonenumber } = useParams();
  const [invoices, setInvoices] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [loading, setLoading] = useState(false);

  /** ---------------- Fetch invoices ---------------- */
  const fetchData = async () => {
    if (!phonenumber) return;
    const { data, error } = await supabase.from("backend").select("*").eq("phonenumber", phonenumber);
    if (error) { console.error(error); return; }
    setInvoices(data.map((inv) => ({
      ...inv,
      Dealer: toUpperIfString(inv.Dealer ?? ""),
      invoice_date: toUpperIfString(inv.invoice_date ?? ""),
      status: toUpperIfString(inv.status ?? ""),
    })));
  };

  useEffect(() => { fetchData(); }, [phonenumber]);

  /** ---------------- Generate PDF ---------------- */
  const generatePDFBlob = (invoice) => {
    const rows = normalizeRows(invoice);
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("INVOICE", 105, 20, { align: "center" });
    doc.setFontSize(12);
    doc.text(`Invoice No: ${invoice.invoice_number ?? ""}`, 20, 40);
    doc.text(`Dealer: ${invoice.Dealer ?? ""}`, 20, 50);
    doc.text(`Phone: ${invoice.phonenumber ?? ""}`, 20, 60);
    doc.text(`Date: ${invoice.invoice_date ?? ""}`, 20, 70);
    doc.text(`Status: ${invoice.status ?? ""}`, 20, 80);
    let total = 0;
    const tableData = rows.map((r) => {
      const line = num(r.quantity) * num(r.rate); total += line;
      return [r.productname, r.description, String(r.quantity), r.units, num(r.rate).toFixed(2), line.toFixed(2)];
    });
    autoTable(doc, {
      startY: 95,
      head: [["Product","Description","Quantity","Units","Rate","Amount"]],
      body: [...tableData, ["","","","","Total", total.toFixed(2)]],
      theme: "grid",
      styles: { halign: "center", valign: "middle" },
    });
    doc.text("Authorized Signature: ____________________", 20, (doc.lastAutoTable?.finalY ?? 120)+20);
    return doc.output("blob");
  };

  /** ---------------- Approve ---------------- */
  const handleApprove = async (inv) => {
    try {
      setLoading(true);
      const rows = normalizeRows(inv);
      const total = rows.map((r) => num(r.quantity)*num(r.rate)).reduce((a,b)=>a+b,0);
      await supabase.from("backend").update({ status:"APPROVED", total, amount:total }).eq("phonenumber", inv.phonenumber);
      const pdfBlob = generatePDFBlob({...inv, status:"APPROVED"});
      const fileName = `invoice_${inv.phonenumber}.pdf`;
      await supabase.storage.from("invoices").upload(fileName, pdfBlob, { contentType:"application/pdf", upsert:true });
      const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(fileName);
      await supabase.from("backend").update({ pdf_url: urlData.publicUrl }).eq("phonenumber", inv.phonenumber);
      alert("✅ Approved & PDF uploaded!");
      fetchData();
    } catch(e){ console.error(e); alert("❌ Approve failed"); }
    finally{ setLoading(false); }
  };

  /** ---------------- Edit / Save ---------------- */
  const handleEdit = (inv) => {
    setEditId(inv.phonenumber);
    setEditData({...inv, rows: normalizeRows(inv)});
  };
  const handleChangeHeader = (field, value) => setEditData(s=>({...s,[field]:value}));
  const handleRowChange = (i,f,v)=>{ setEditData(s=>{ const rows=[...s.rows]; rows[i][f]=v; return {...s,rows}; }); };
  const addRow = ()=>setEditData(s=>({...s,rows:[...s.rows,{productname:"",description:"",quantity:"",units:"",rate:""}]}));
  const removeRow = (i)=>setEditData(s=>({...s,rows:s.rows.filter((_,idx)=>idx!==i)}));
  const calcEditTotals = useMemo(()=>{ if(!editId||!editData.rows) return {total:0}; const total=editData.rows.map(r=>num(r.quantity)*num(r.rate)).reduce((a,b)=>a+b,0); return {total}; },[editId,editData]);
  const handleSave = async ()=>{
    try{
      setLoading(true);
      const rows = (editData.rows||[]).filter(r=>r.productname||r.description||r.quantity||r.units||r.rate);
      const payload = {
        invoice_number: editData.invoice_number||"",
        Dealer: editData.Dealer||"",
        phonenumber: editData.phonenumber||"",
        invoice_date: editData.invoice_date||"",
        productname: JSON.stringify(rows.map(r=>r.productname||"")),
        description: JSON.stringify(rows.map(r=>r.description||"")),
        quantity: JSON.stringify(rows.map(r=>r.quantity||"")),
        units: JSON.stringify(rows.map(r=>r.units||"")),
        rate: JSON.stringify(rows.map(r=>r.rate||"")),
        total: calcEditTotals.total,
        amount: calcEditTotals.total,
        status:"DRAFT",
      };
      await supabase.from("backend").update(payload).eq("phonenumber",editId);
      alert("💾 Saved successfully!");
      setEditId(null); setEditData({});
      fetchData();
    }catch(e){ console.error(e); alert("❌ Save failed"); } finally{ setLoading(false); }
  };

  /** ---------------- Render ---------------- */
  return (
    <div style={{padding:20,opacity:loading?0.6:1}}>
      <h2>Invoices for {phonenumber}</h2>
      {invoices.map(inv=>{
        const rows = normalizeRows(inv);
        const total = rows.map(r=>num(r.quantity)*num(r.rate)).reduce((a,b)=>a+b,0);
        const isEditing = editId===inv.phonenumber;
        return <div key={inv.phonenumber} style={{border:"2px solid #222",padding:12,borderRadius:8,marginBottom:20}}>
          <h3>INVOICE: {isEditing ? <input value={editData.invoice_number} onChange={e=>handleChangeHeader("invoice_number",e.target.value)} style={{width:220}}/> : inv.invoice_number}</h3>
          {isEditing ? <div style={{display:"grid",gap:6,maxWidth:600}}>
            <label>Dealer: <input value={editData.Dealer} onChange={e=>handleChangeHeader("Dealer",e.target.value)} /></label>
            <label>Phone: <input value={editData.phonenumber} onChange={e=>handleChangeHeader("phonenumber",e.target.value)} /></label>
            <label>Date: <input value={editData.invoice_date} onChange={e=>handleChangeHeader("invoice_date",e.target.value)} /></label>
            <div>Status: {inv.status}</div>
          </div> : <p><b>DEALER:</b> {inv.Dealer}<br/><b>PHONE:</b> {inv.phonenumber}<br/><b>DATE:</b> {inv.invoice_date}<br/><b>STATUS:</b> {inv.status}<br/>{inv.pdf_url && <a href={inv.pdf_url} target="_blank" rel="noreferrer">📄 View PDF</a>}</p>}
          <table border="1" cellPadding="6" style={{width:"100%",borderCollapse:"collapse",marginTop:10}}>
            <thead><tr><th>PRODUCT</th><th>DESCRIPTION</th><th>QUANTITY</th><th>UNITS</th><th>RATE</th><th>AMOUNT</th>{isEditing && <th>ACTION</th>}</tr></thead>
            <tbody>
              {(isEditing?editData.rows:rows).map((r,i)=>{
                const amount = num(r.quantity)*num(r.rate);
                return <tr key={i}>
                  {isEditing ? <>
                    <td><input value={r.productname} onChange={e=>handleRowChange(i,"productname",e.target.value)} /></td>
                    <td><input value={r.description} onChange={e=>handleRowChange(i,"description",e.target.value)} /></td>
                    <td><input value={r.quantity} onChange={e=>handleRowChange(i,"quantity",e.target.value)} /></td>
                    <td><input value={r.units} onChange={e=>handleRowChange(i,"units",e.target.value)} /></td>
                    <td><input value={r.rate} onChange={e=>handleRowChange(i,"rate",e.target.value)} /></td>
                    <td>{amount.toFixed(2)}</td>
                    <td><button onClick={()=>removeRow(i)}>Remove</button></td>
                  </> : <>
                    <td>{r.productname}</td><td>{r.description}</td><td>{r.quantity}</td><td>{r.units}</td><td>{r.rate}</td><td>{amount.toFixed(2)}</td>
                  </>}
                </tr>
              })}
              <tr><td colSpan={5} style={{textAlign:"right",fontWeight:"bold"}}>TOTAL</td><td style={{fontWeight:"bold"}}>{isEditing ? calcEditTotals.total.toFixed(2):total.toFixed(2)}</td>{isEditing && <td/>}</tr>
            </tbody>
          </table>
          {isEditing ? <>
            <button onClick={addRow} style={{marginTop:10,marginRight:10}}>Add Item</button>
            <button onClick={handleSave} style={{marginTop:10}}>Save</button>
          </> : <button onClick={()=>handleEdit(inv)} style={{marginTop:10,marginRight:10}}>Edit</button>}
          <button onClick={()=>handleApprove(inv)} style={{marginTop:10,marginLeft:10}}>Approve</button>
        </div>
      })}
    </div>
  );
}

/** ---------------- Root App ---------------- */
export default function AppWrapper() {
  return <Router>
    <Routes>
      <Route path="/:phonenumber" element={<InvoicePage/>} />
      <Route path="*" element={<p>Enter phone number in URL e.g. /917975227055</p>} />
    </Routes>
  </Router>;
}
