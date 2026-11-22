// invoice_render.js v1.0.0 — 2026-11-23
// Builds a Beyond the Box TAX INVOICE as HTML (same layout as the Xero template). Used by invoices.html
// (preview, print, email) and invoice_view.html (customer's view / print link). Prices are GST-inclusive.
(function(){
  const SELLER={
    name:'Beyond the Box Escape Rooms',
    address:['105 Market Street North','Hastings 4122'],
    phone:'0220 537 365',
    email:'Keren@btbEscapeRooms.co.nz',
    gst:'132-864-330',
    bankName:'Keane and Matthews Partnership',
    bankAccount:'38-9022-0859175-00',
  };
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n2=v=>(Number(v)||0).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});
  const neg=v=>Number(v)<0?`(${n2(Math.abs(v))})`:n2(v);
  const d=s=>s?new Date(String(s).slice(0,10)+'T12:00').toLocaleDateString('en-NZ',{day:'2-digit',month:'short',year:'numeric'}):'';
  function totals(inv){
    const lines=Array.isArray(inv.lines)?inv.lines:[];
    const total=Math.round(lines.reduce((a,l)=>a+(Number(l.amount)||0),0)*100)/100;
    const gst=Math.round(total*3/23*100)/100; // 15% GST included in the price
    const paid=Number(inv.paid_amount)||0;
    return{lines,total,gst,paid,due:Math.round((total-paid)*100)/100};
  }
  // opts.email = true → simpler email-safe layout (no background image)
  function render(inv,opts={}){
    const t=totals(inv),email=!!opts.email;
    const rows=t.lines.map(l=>`<tr>
      <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;font-size:13px">${esc(l.description)}</td>
      <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${n2(l.qty??1)}</td>
      <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${neg(l.unit_price??l.amount)}</td>
      <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">15%</td>
      <td style="padding:7px 6px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right">${neg(l.amount)}</td></tr>`).join('');
    const sumRow=(label,val,bold)=>`<tr><td colspan="4" style="padding:5px 6px;text-align:right;font-size:13px;${bold?'font-weight:700;border-top:2px solid #111827':''}">${label}</td><td style="padding:5px 6px;text-align:right;font-size:13px;${bold?'font-weight:700;border-top:2px solid #111827':''}">${val}</td></tr>`;
    const body=`
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px"><tr>
        <td style="vertical-align:top;width:55%">
          <div style="font-size:26px;font-weight:700;letter-spacing:1px;margin-bottom:14px">${inv.status==='void'?'VOID — ':''}TAX INVOICE</div>
          <div style="font-size:14px;font-weight:700">${esc(inv.bill_to)}</div>
          ${inv.contact_name?`<div style="font-size:13px">Attn: ${esc(inv.contact_name)}</div>`:''}
          ${inv.bill_address?`<div style="font-size:13px;white-space:pre-line">${esc(inv.bill_address)}</div>`:''}
        </td>
        <td style="vertical-align:top;font-size:13px">
          <table style="border-collapse:collapse">
            <tr><td style="padding:1px 10px 1px 0;font-weight:700">Invoice Date</td><td>${d(inv.issue_date)}</td></tr>
            <tr><td style="padding:1px 10px 1px 0;font-weight:700">Invoice Number</td><td>${esc(inv.invoice_number)}</td></tr>
            ${inv.po_number?`<tr><td style="padding:1px 10px 1px 0;font-weight:700">Reference</td><td>${esc(inv.po_number)}</td></tr>`:''}
            <tr><td style="padding:1px 10px 1px 0;font-weight:700">GST Number</td><td>${SELLER.gst}</td></tr>
          </table>
          <div style="margin-top:10px;line-height:1.45">${SELLER.name}<br>${SELLER.address.join('<br>')}<br>${SELLER.phone}<br>${SELLER.email}</div>
        </td></tr></table>
      ${inv.reference?`<div style="font-size:13px;margin:0 0 8px"><b>For:</b> ${esc(inv.reference)}</div>`:''}
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f3f4f6">
          <th style="text-align:left;padding:7px 6px;font-size:12px">Description</th>
          <th style="text-align:right;padding:7px 6px;font-size:12px">Quantity</th>
          <th style="text-align:right;padding:7px 6px;font-size:12px">Unit Price</th>
          <th style="text-align:right;padding:7px 6px;font-size:12px">GST</th>
          <th style="text-align:right;padding:7px 6px;font-size:12px">Amount NZD</th></tr>
        ${rows}
        ${sumRow('Subtotal (includes GST)',n2(t.total))}
        ${sumRow('Total GST 15%',n2(t.gst))}
        ${sumRow('Invoice Total NZD',n2(t.total),true)}
        ${t.paid?sumRow('Total Net Payments NZD',n2(t.paid)):''}
        ${sumRow('Amount Due NZD',n2(Math.max(0,t.due)),true)}
      </table>
      <div style="margin-top:14px;font-size:14px"><b>Due Date: ${d(inv.due_date)}</b></div>
      <div style="margin-top:18px;padding:12px 14px;border:1px dashed #07b4c5;border-radius:8px;font-size:13px;line-height:1.5;background:#f0fafb">
        <b>How to pay</b><br>Internet banking to <b>${SELLER.bankName}</b><br>Account number <b>${SELLER.bankAccount}</b><br>
        Please use reference <b>${esc(inv.invoice_number)}</b>${inv.po_number?` or <b>${esc(inv.po_number)}</b>`:''}.</div>
      ${t.due<=0&&t.total>0?`<div style="margin-top:12px;font-size:14px;color:#15803d;font-weight:700">PAID — thank you!</div>`:''}`;
    if(email)return`<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827">
      <div style="background:#07b4c5;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700">Beyond the Box Escape Rooms</div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:18px">${opts.intro||''}${body}
      ${opts.viewUrl?`<p style="margin:18px 0 0;font-size:13px"><a href="${esc(opts.viewUrl)}" style="color:#07b4c5">View or print this invoice (save as PDF)</a></p>`:''}</div></div>`;
    return`<div class="inv-page" style="position:relative;width:210mm;min-height:297mm;margin:0 auto;background:#fff url('invoice_letterhead.png') top left/100% 100% no-repeat;padding:72mm 16mm 40mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#111827">${body}</div>`;
  }
  window.BtbInvoice={SELLER,render,totals,esc};
})();
