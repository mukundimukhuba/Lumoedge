import{i as e,t}from"./react-B8IZ02wI.js";import{n}from"./createLucideIcon-DyCq-HOk.js";import{r as apiUrl}from"./apiBase-CDudBPOx.js";import{n as useAdmin,r as useSession}from"./index-BN3mw-4aa.js";var React=e(t(),1),jsx=n();

function sessionHeaders(admin){
  let token=``;
  try{token=JSON.parse(localStorage.getItem(`ub-web/admin-session-v1`)||`{}`).token||``}catch{}
  const headers={'Content-Type':`application/json`};
  if(token){headers.Authorization=`Bearer ${token}`;headers[`x-lumo-session`]=token}
  if(admin?.id) headers[`x-lumo-admin-id`]=String(admin.id);
  return headers;
}
function field(label,value,onChange,extra){
  return jsx.jsxs(`div`,{className:`field`,children:[
    jsx.jsx(`label`,{children:label}),
    extra?.area
      ? jsx.jsx(`textarea`,{value:value||``,onChange:e=>onChange(e.target.value),rows:extra.rows||4})
      : jsx.jsx(`input`,{value:value||``,onChange:e=>onChange(e.target.value),placeholder:extra?.placeholder||``})
  ]});
}
function previewSite(draft){
  return {
    robotName:draft.robotName||`Your robot`,
    headline:draft.headline||``,
    shortDescription:draft.shortDescription||``,
    robotDescription:draft.robotDescription||``,
    robotImage:draft.robotImage||`/lumo-logo.png`,
    mentorName:draft.mentorName||``,
    mentorBio:draft.mentorBio||``,
    mentorImage:draft.mentorImage||`/lumo-logo.png`,
    pricing:{
      iphone:{label:`iPhone`,price:draft.iphonePrice||`R0`,duration:draft.iphoneDuration||`Set duration`,platform:`iphone`},
      android:{label:`Android`,price:draft.androidPrice||`R0`,duration:draft.androidDuration||`Set duration`,platform:`android`}
    },
    contacts:{
      whatsapp:draft.whatsapp||``,
      whatsappLink:draft.whatsappLink||``,
      email:draft.email||``,
      telegram:draft.telegram||``,
      instagram:draft.instagram||``,
      tiktok:draft.tiktok||``
    }
  };
}

function MiniPreview({draft}){
  const site=previewSite(draft);
  return jsx.jsxs(`div`,{className:`le-store le-preview-frame le-glass`,style:{pointerEvents:`none`,maxHeight:640,overflow:`hidden`},children:[
    jsx.jsxs(`div`,{className:`le-store-nav-row`,children:[
      jsx.jsxs(`div`,{className:`le-store-brand`,children:[jsx.jsx(`img`,{src:`/lumo-logo.png`,alt:``}),jsx.jsx(`span`,{children:`LUMO EDGE`})]}),
      jsx.jsx(`div`,{className:`le-store-powered`,children:`Powered by Lumo Edge`})
    ]}),
    jsx.jsxs(`div`,{className:`le-store-hero`,style:{padding:`18px 0`},children:[
      jsx.jsxs(`div`,{children:[
        jsx.jsx(`h1`,{style:{fontSize:28},children:site.robotName}),
        site.headline?jsx.jsx(`p`,{style:{color:`#67e8f9`},children:site.headline}):null,
        jsx.jsx(`p`,{children:site.shortDescription})
      ]}),
      jsx.jsx(`img`,{src:site.robotImage||`/lumo-logo.png`,alt:``,style:{width:`100%`,borderRadius:18,aspectRatio:`1`,objectFit:`cover`}})
    ]}),
    jsx.jsx(`div`,{className:`le-price-grid`,children:[site.pricing.iphone,site.pricing.android].map(card=>jsx.jsxs(`div`,{className:`le-glass le-price-card`,children:[
      jsx.jsx(`strong`,{children:card.label}),
      jsx.jsx(`div`,{children:card.duration}),
      jsx.jsx(`div`,{children:card.price})
    ]},card.platform))})
  ]});
}

function MentorWebsitePage(){
  const {admin}=useAdmin();
  useSession();
  const [website,setWebsite]=(0,React.useState)(null);
  const [draft,setDraft]=(0,React.useState)({});
  const [mode,setMode]=(0,React.useState)(`home`);
  const [busy,setBusy]=(0,React.useState)(``);
  const [message,setMessage]=(0,React.useState)(``);
  const [error,setError]=(0,React.useState)(``);
  const [list,setList]=(0,React.useState)([]);
  const [orders,setOrders]=(0,React.useState)([]);
  const isSuper=admin?.role===`super`;
  const setField=(key)=>(value)=>setDraft((e)=>({...e,[key]:value}));

  const load=async()=>{
    const res=await fetch(apiUrl(`/api/websites/me`),{headers:sessionHeaders(admin),cache:`no-store`});
    const data=await res.json().catch(()=>({}));
    if(data.website){setWebsite(data.website);setDraft(data.website)}
    else {setWebsite(null);setDraft({})}
    const orderRes=await fetch(apiUrl(`/api/websites/me/orders`),{headers:sessionHeaders(admin),cache:`no-store`});
    const orderData=await orderRes.json().catch(()=>({}));
    setOrders(Array.isArray(orderData.orders)?orderData.orders:[]);
    if(isSuper){
      const all=await fetch(apiUrl(`/api/websites`),{headers:sessionHeaders(admin),cache:`no-store`});
      const allData=await all.json().catch(()=>({}));
      setList(Array.isArray(allData.websites)?allData.websites:[]);
    }
  };
  (0,React.useEffect)(()=>{if(admin?.id) load()},[admin?.id]);

  const create=async()=>{
    setBusy(`create`);setError(``);
    try{
      const res=await fetch(apiUrl(`/api/websites/me`),{method:`POST`,headers:sessionHeaders(admin),body:`{}`});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok) throw Error(data.error||`Could not create website`);
      setWebsite(data.website);setDraft(data.website);setMode(`edit`);
    }catch(e){setError(e instanceof Error?e.message:`Could not create website`)}
    finally{setBusy(``)}
  };
  const save=async()=>{
    setBusy(`save`);setError(``);setMessage(``);
    try{
      const res=await fetch(apiUrl(`/api/websites/me`),{method:`PUT`,headers:sessionHeaders(admin),body:JSON.stringify(draft)});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok) throw Error(data.error||`Save failed`);
      setWebsite(data.website);setDraft(data.website);setMessage(`Changes saved.`);
    }catch(e){setError(e instanceof Error?e.message:`Save failed`)}
    finally{setBusy(``)}
  };
  const publish=async()=>{
    setBusy(`publish`);setError(``);setMessage(``);
    try{
      const res=await fetch(apiUrl(`/api/websites/me/publish`),{method:`POST`,headers:sessionHeaders(admin),body:JSON.stringify(draft)});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok) throw Error(data.missing?`Add robot name, both prices, and both durations.`:data.error||`Publish failed`);
      setWebsite(data.website);setDraft(data.website);setMode(`home`);setMessage(data.message||`Your Lumo Edge website is now live.`);
    }catch(e){setError(e instanceof Error?e.message:`Publish failed`)}
    finally{setBusy(``)}
  };
  const unpublish=async()=>{
    setBusy(`unpublish`);
    try{
      const res=await fetch(apiUrl(`/api/websites/me/unpublish`),{method:`POST`,headers:sessionHeaders(admin),body:`{}`});
      const data=await res.json().catch(()=>({}));
      if(data.website){setWebsite(data.website);setDraft(data.website)}
    }finally{setBusy(``)}
  };
  const upload=async(kind,file)=>{
    if(!file||!admin?.id) return;
    if(!String(file.type||``).startsWith(`image/`)) {setError(`Upload a JPG or PNG image.`);return;}
    const dataUrl=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||``));
      reader.onerror=()=>reject(Error(`Could not read image`));
      reader.readAsDataURL(file);
    });
    const key=`web-${kind}-${admin.id}`;
    const res=await fetch(apiUrl(`/api/images/${encodeURIComponent(key)}`),{method:`PUT`,headers:sessionHeaders(admin),body:JSON.stringify({dataUrl})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) {setError(data.error||`Image upload failed`);return;}
    setDraft((e)=>({...e,[kind===`robot`?`robotImage`:`mentorImage`]:data.url||`/api/images/${encodeURIComponent(key)}`}));
  };
  const copy=async()=>{
    if(!website?.url) return;
    try{await navigator.clipboard.writeText(website.url);setMessage(`Link copied.`)}catch{}
  };
  const confirmOrder=async(orderId)=>{
    const res=await fetch(apiUrl(`/api/store/orders/${orderId}/confirm`),{method:`POST`,headers:sessionHeaders(admin),body:`{}`});
    const data=await res.json().catch(()=>({}));
    if(data.ok){setMessage(`Payment confirmed. License email sent.`);load()}
    else setError(data.error||`Could not confirm payment`);
  };
  const superAction=async(id,status)=>{
    await fetch(apiUrl(`/api/websites/${encodeURIComponent(id)}`),{method:`PATCH`,headers:sessionHeaders(admin),body:JSON.stringify({status})});
    load();
  };
  const live=website?.status===`published`;
  const url=website?.url||``;

  if(!website){
    return jsx.jsxs(`div`,{className:`le-web-admin`,children:[
      jsx.jsx(`h2`,{className:`title-blue`,style:{margin:0},children:`My Website`}),
      jsx.jsx(`p`,{className:`muted`,children:`Create Your Lumo Edge Website`}),
      jsx.jsx(`button`,{className:`btn btn-blue`,disabled:!!busy,onClick:()=>void create(),children:busy?`Creating…`:`CREATE WEBSITE`}),
      error?jsx.jsx(`p`,{className:`error`,children:error}):null,
      isSuper&&list.length?jsx.jsxs(`div`,{className:`glow-card`,children:[jsx.jsx(`h3`,{children:`All mentor websites`}),list.map(row=>jsx.jsxs(`div`,{style:{padding:`10px 0`,borderTop:`1px solid #222`},children:[
        jsx.jsx(`strong`,{children:row.robotName||row.slug}),
        jsx.jsx(`div`,{className:`muted`,children:`${row.mentorId} · ${row.status} · ${row.url||`unpublished`}`}),
        jsx.jsxs(`div`,{style:{display:`flex`,gap:8,marginTop:8},children:[
          row.url?jsx.jsx(`a`,{className:`btn btn-ghost`,href:row.url,target:`_blank`,rel:`noreferrer`,children:`View`}):null,
          jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void superAction(row.websiteId,`disable`),children:`Disable`}),
          jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void superAction(row.websiteId,`enable`),children:`Re-enable`}),
          jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void superAction(row.websiteId,`unpublish`),children:`Unpublish`})
        ]})
      ]},row.websiteId))]}):null
    ]});
  }

  if(mode===`edit`||mode===`preview`){
    return jsx.jsxs(`div`,{className:`le-web-admin`,children:[
      jsx.jsx(`h2`,{className:`title-blue`,style:{margin:0},children:`Customize website`}),
      jsx.jsx(`p`,{className:`muted`,children:`Lumo Edge controls the layout. You control the content.`}),
      jsx.jsxs(`div`,{className:`le-web-split`,children:[
        jsx.jsxs(`div`,{className:`glow-card le-form-grid`,children:[
          jsx.jsx(`h3`,{style:{margin:0},children:`Website information`}),
          field(`Robot / EA Name`,draft.robotName,setField(`robotName`)),
          field(`Headline`,draft.headline,setField(`headline`)),
          field(`Short Description`,draft.shortDescription,setField(`shortDescription`),{area:true,rows:3}),
          field(`Long Description / About Robot`,draft.robotDescription,setField(`robotDescription`),{area:true,rows:6}),
          jsx.jsx(`h3`,{children:`Robot image`}),
          draft.robotImage?jsx.jsx(`img`,{src:draft.robotImage,alt:``,style:{width:120,height:120,objectFit:`cover`,borderRadius:16}}):null,
          jsx.jsx(`input`,{type:`file`,accept:`image/*`,onChange:e=>void upload(`robot`,e.target.files?.[0])}),
          jsx.jsx(`h3`,{children:`Pricing`}),
          jsx.jsx(`p`,{className:`muted`,children:`Exactly two cards: iPhone and Android. Duration is your wording.`}),
          field(`iPhone price`,draft.iphonePrice,setField(`iphonePrice`),{placeholder:`R600`}),
          field(`iPhone duration`,draft.iphoneDuration,setField(`iphoneDuration`),{placeholder:`30 Days`}),
          field(`Android price`,draft.androidPrice,setField(`androidPrice`),{placeholder:`R500`}),
          field(`Android duration`,draft.androidDuration,setField(`androidDuration`),{placeholder:`30 Days`}),
          jsx.jsx(`h3`,{children:`About the mentor`}),
          field(`First Name / Display Name`,draft.mentorName,setField(`mentorName`)),
          field(`Mentor Description / Biography`,draft.mentorBio,setField(`mentorBio`),{area:true}),
          draft.mentorImage?jsx.jsx(`img`,{src:draft.mentorImage,alt:``,style:{width:88,height:88,borderRadius:`50%`,objectFit:`cover`}}):null,
          jsx.jsx(`input`,{type:`file`,accept:`image/*`,onChange:e=>void upload(`mentor`,e.target.files?.[0])}),
          jsx.jsx(`h3`,{children:`Contact & social links`}),
          field(`WhatsApp Number`,draft.whatsapp,setField(`whatsapp`)),
          field(`WhatsApp Link`,draft.whatsappLink,setField(`whatsappLink`)),
          field(`Email`,draft.email,setField(`email`)),
          field(`Telegram`,draft.telegram,setField(`telegram`)),
          field(`Instagram`,draft.instagram,setField(`instagram`)),
          field(`TikTok`,draft.tiktok,setField(`tiktok`))
        ]}),
        jsx.jsxs(`div`,{children:[
          jsx.jsx(`h3`,{children:`Live preview`}),
          jsx.jsx(MiniPreview,{draft})
        ]})
      ]}),
      jsx.jsxs(`div`,{style:{display:`flex`,gap:8,flexWrap:`wrap`},children:[
        jsx.jsx(`button`,{className:`btn btn-ghost`,disabled:!!busy,onClick:()=>void save(),children:`SAVE CHANGES`}),
        jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>setMode(mode===`preview`?`edit`:`preview`),children:`PREVIEW FULL WEBSITE`}),
        jsx.jsx(`button`,{className:`btn btn-blue`,disabled:!!busy,onClick:()=>void publish(),children:`PUBLISH WEBSITE`}),
        jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>setMode(`home`),children:`Back`})
      ]}),
      mode===`preview`?jsx.jsx(`div`,{className:`glow-card`,children:jsx.jsx(MiniPreview,{draft})}):null,
      message?jsx.jsx(`p`,{className:`success`,children:message}):null,
      error?jsx.jsx(`p`,{className:`error`,children:error}):null
    ]});
  }

  return jsx.jsxs(`div`,{className:`le-web-admin`,children:[
    jsx.jsx(`h2`,{className:`title-blue`,style:{margin:0},children:`My Website`}),
    jsx.jsxs(`p`,{children:[jsx.jsx(`span`,{className:`le-status-dot ${live?``:website.status===`draft`?`draft`:`down`}`}),`Website Status: ${live?`PUBLISHED`:String(website.status||`DRAFT`).toUpperCase()}`]}),
    url?jsx.jsxs(`p`,{children:[`Website URL: `,jsx.jsx(`strong`,{children:url.replace(`https://`,``)})]}):jsx.jsx(`p`,{className:`muted`,children:`Publish to get your public Lumo Edge link.`}),
    message?jsx.jsx(`p`,{className:`success`,children:message}):null,
    error?jsx.jsx(`p`,{className:`error`,children:error}):null,
    jsx.jsxs(`div`,{style:{display:`flex`,gap:8,flexWrap:`wrap`},children:[
      url?jsx.jsx(`a`,{className:`btn btn-blue`,href:website.publicPath||url,target:`_blank`,rel:`noreferrer`,children:`OPEN WEBSITE`}):null,
      jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>setMode(`edit`),children:`CUSTOMIZE`}),
      jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>setMode(`preview`),children:`PREVIEW`}),
      live?jsx.jsx(`button`,{className:`btn btn-ghost`,disabled:!!busy,onClick:()=>void unpublish(),children:`UNPUBLISH`}):jsx.jsx(`button`,{className:`btn btn-blue`,disabled:!!busy,onClick:()=>void publish(),children:`PUBLISH`} ),
      url?jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void copy(),children:`COPY LINK`}):null
    ]}),
    orders.length?jsx.jsxs(`div`,{className:`glow-card`,children:[
      jsx.jsx(`h3`,{children:`Store orders`}),
      orders.map(row=>jsx.jsxs(`div`,{style:{padding:`10px 0`,borderTop:`1px solid #222`},children:[
        jsx.jsx(`strong`,{children:`${row.platform} · ${row.amount}`}),
        jsx.jsx(`div`,{className:`muted`,children:`${row.customerEmail} · ${row.status}`}),
        row.status!==`paid`?jsx.jsx(`button`,{className:`btn btn-blue`,style:{marginTop:8},onClick:()=>void confirmOrder(row.orderId),children:`Confirm payment`}):jsx.jsx(`div`,{style:{color:`#4ade80`},children:`Paid · license emailed`})
      ]},row.orderId))
    ]}):null,
    isSuper&&list.length?jsx.jsxs(`div`,{className:`glow-card`,children:[
      jsx.jsx(`h3`,{children:`All mentor websites`}),
      list.map(row=>jsx.jsxs(`div`,{style:{padding:`10px 0`,borderTop:`1px solid #222`},children:[
        jsx.jsx(`strong`,{children:row.robotName||`Untitled`}),
        jsx.jsx(`div`,{className:`muted`,children:`${row.mentorId} · ${row.status} · ${row.url||`no url`}`}),
        jsx.jsx(`div`,{className:`muted`,children:`Created ${String(row.createdAt||``).slice(0,10)} · Published ${String(row.publishedAt||``).slice(0,10)||`—`}`}),
        jsx.jsxs(`div`,{style:{display:`flex`,gap:8,marginTop:8,flexWrap:`wrap`},children:[
          row.url?jsx.jsx(`a`,{className:`btn btn-ghost`,href:row.publicPath||row.url,target:`_blank`,rel:`noreferrer`,children:`View`}):null,
          jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void superAction(row.websiteId,`disable`),children:`Disable`}),
          jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void superAction(row.websiteId,`enable`),children:`Re-enable`}),
          jsx.jsx(`button`,{className:`btn btn-ghost`,onClick:()=>void superAction(row.websiteId,`unpublish`),children:`Unpublish`})
        ]})
      ]},row.websiteId))
    ]}):null
  ]});
}

export{MentorWebsitePage};
