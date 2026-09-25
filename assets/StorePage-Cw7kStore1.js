import{i as e,t}from"./react-B8IZ02wI.js";import{n}from"./createLucideIcon-DyCq-HOk.js";import{r as apiUrl}from"./apiBase-CDudBPOx.js";var React=e(t(),1),jsx=n();

function pathParts(){
  const parts=String(window.location.pathname||``).split(`/`).filter(Boolean);
  return {slug:decodeURIComponent(parts[1]||``),orderId:parts[2]===`checkout`?decodeURIComponent(parts[3]||``):``};
}
function esc(value){return String(value||``)}
function imgSrc(url){
  const value=String(url||``).trim();
  if(!value) return `/lumo-logo.png`;
  if(value.startsWith(`data:`)||value.startsWith(`http`)||value.startsWith(`/`)) return value;
  return `/lumo-logo.png`;
}

function StoreChrome({website,children}){
  return jsx.jsxs(`div`,{className:`le-store`,children:[
    jsx.jsx(`header`,{className:`le-store-nav`,children:jsx.jsxs(`div`,{className:`le-store-wrap le-store-nav-row`,children:[
      jsx.jsxs(`a`,{href:`#home`,className:`le-store-brand`,style:{textDecoration:`none`},children:[
        jsx.jsx(`img`,{src:`/lumo-logo.png`,alt:`Lumo Edge`}),
        jsx.jsx(`span`,{children:`LUMO EDGE`})
      ]}),
      jsx.jsxs(`nav`,{className:`le-store-links`,children:[
        jsx.jsx(`a`,{href:`#home`,children:`Home`}),
        jsx.jsx(`a`,{href:`#about`,children:`About`}),
        jsx.jsx(`a`,{href:`#features`,children:`Features`}),
        jsx.jsx(`a`,{href:`#pricing`,children:`Pricing`}),
        jsx.jsx(`a`,{href:`#contact`,children:`Contact`})
      ]}),
      jsx.jsx(`div`,{className:`le-store-powered`,children:`Powered by Lumo Edge`})
    ]})}),
    jsx.jsxs(`nav`,{className:`le-store-wrap le-mobile-nav`,children:[
      jsx.jsx(`a`,{href:`#home`,children:`Home`}),
      jsx.jsx(`a`,{href:`#about`,children:`About`}),
      jsx.jsx(`a`,{href:`#pricing`,children:`Pricing`}),
      jsx.jsx(`a`,{href:`#contact`,children:`Contact`})
    ]}),
    children,
    jsx.jsxs(`footer`,{className:`le-store-footer`,children:[
      jsx.jsx(`div`,{children:`© Lumo Edge. All rights reserved.`}),
      jsx.jsx(`div`,{children:`This website is hosted and powered by Lumo Edge.`}),
      website?.robotName?jsx.jsx(`div`,{children:website.robotName}):null
    ]})
  ]});
}

function PricingCards({website,onBuy}){
  const cards=[website.pricing.iphone,website.pricing.android];
  return jsx.jsx(`div`,{className:`le-price-grid`,children:cards.map((card)=>jsx.jsxs(`article`,{className:`le-glass le-price-card`,children:[
    jsx.jsx(`div`,{className:`le-store-kicker`,children:card.label}),
    jsx.jsx(`div`,{children:esc(card.duration)}),
    jsx.jsx(`strong`,{children:esc(card.price)}),
    jsx.jsx(`button`,{type:`button`,className:`le-btn le-btn-cyan`,onClick:()=>onBuy(card.platform),children:`BUY NOW`})
  ]},card.platform))});
}

function WebsiteBody({website,onBuy}){
  const contacts=website.contacts||{};
  return jsx.jsxs(`main`,{className:`le-store-wrap`,children:[
    jsx.jsxs(`section`,{id:`home`,className:`le-store-hero`,children:[
      jsx.jsxs(`div`,{children:[
        jsx.jsx(`p`,{className:`le-store-kicker`,children:`Lumo Edge robot`}),
        jsx.jsx(`h1`,{children:esc(website.robotName)}),
        website.headline?jsx.jsx(`p`,{style:{color:`#67e8f9`,fontWeight:700},children:esc(website.headline)}):null,
        website.shortDescription?jsx.jsx(`p`,{className:`le-store-lead`,children:esc(website.shortDescription)}):null,
        jsx.jsx(`a`,{href:`#pricing`,className:`le-btn le-btn-cyan`,children:`GET STARTED`})
      ]}),
      jsx.jsx(`div`,{className:`le-store-visual`,children:jsx.jsx(`img`,{src:imgSrc(website.robotImage),alt:website.robotName||`Robot`})})
    ]}),
    jsx.jsxs(`section`,{id:`about`,className:`le-section`,children:[
      jsx.jsx(`h2`,{children:`About the robot`}),
      jsx.jsxs(`div`,{className:`le-glass`,children:[
        jsx.jsx(`h3`,{style:{marginTop:0},children:esc(website.robotName)}),
        jsx.jsx(`p`,{style:{whiteSpace:`pre-wrap`,lineHeight:1.7,color:`#d7e0f5`},children:esc(website.robotDescription||website.shortDescription||`Details coming soon from the mentor.`)})
      ]})
    ]}),
    jsx.jsxs(`section`,{id:`features`,className:`le-section`,children:[
      jsx.jsx(`h2`,{children:`Features`}),
      jsx.jsx(`div`,{className:`le-price-grid`,children:[website.pricing.iphone.duration,website.pricing.android.duration,website.mentorName].filter(Boolean).slice(0,3).map((item,i)=>jsx.jsxs(`div`,{className:`le-glass`,children:[
        jsx.jsx(`div`,{className:`le-store-kicker`,children:i===0?`iPhone access`:i===1?`Android access`:`Mentor`}),
        jsx.jsx(`p`,{style:{margin:0},children:esc(item)})
      ]},i))})
    ]}),
    jsx.jsxs(`section`,{id:`pricing`,className:`le-section`,children:[
      jsx.jsx(`h2`,{children:`Pricing`}),
      jsx.jsx(PricingCards,{website,onBuy})
    ]}),
    jsx.jsxs(`section`,{id:`contact`,className:`le-section`,children:[
      jsx.jsx(`h2`,{children:`About the mentor`}),
      jsx.jsxs(`div`,{className:`le-glass le-mentor`,children:[
        jsx.jsx(`img`,{src:imgSrc(website.mentorImage),alt:website.mentorName||`Mentor`}),
        jsx.jsxs(`div`,{children:[
          jsx.jsx(`h3`,{style:{margin:`0 0 8px`},children:esc(website.mentorName||`Lumo Edge mentor`)}),
          website.mentorBio?jsx.jsx(`p`,{style:{whiteSpace:`pre-wrap`,color:`#cbd5e1`},children:esc(website.mentorBio)}):null,
          jsx.jsxs(`div`,{className:`le-contacts`,children:[
            contacts.whatsapp||contacts.whatsappLink?jsx.jsx(`a`,{className:`le-btn le-btn-cyan`,href:contacts.whatsappLink||`https://wa.me/${String(contacts.whatsapp||``).replace(/[^\d]/g,``)}`,target:`_blank`,rel:`noreferrer`,children:`WhatsApp`}):null,
            contacts.telegram?jsx.jsx(`a`,{className:`le-btn le-btn-ghost`,href:String(contacts.telegram).startsWith(`http`)?contacts.telegram:`https://t.me/${String(contacts.telegram).replace(/^@/,``)}`,target:`_blank`,rel:`noreferrer`,children:`Telegram`}):null,
            contacts.instagram?jsx.jsx(`a`,{className:`le-btn le-btn-ghost`,href:String(contacts.instagram).startsWith(`http`)?contacts.instagram:`https://instagram.com/${String(contacts.instagram).replace(/^@/,``)}`,target:`_blank`,rel:`noreferrer`,children:`Instagram`}):null,
            contacts.tiktok?jsx.jsx(`a`,{className:`le-btn le-btn-ghost`,href:String(contacts.tiktok).startsWith(`http`)?contacts.tiktok:`https://tiktok.com/@${String(contacts.tiktok).replace(/^@/,``)}`,target:`_blank`,rel:`noreferrer`,children:`TikTok`}):null,
            contacts.email?jsx.jsx(`a`,{className:`le-btn le-btn-ghost`,href:`mailto:${contacts.email}`,children:`Email`}):null
          ]})
        ]})
      ]})
    ]})
  ]});
}

function Checkout({slug,orderId,website}){
  const [order,setOrder]=(0,React.useState)(null);
  const [note,setNote]=(0,React.useState)(``);
  (0,React.useEffect)(()=>{(async()=>{
    const res=await fetch(apiUrl(`/api/store/orders/${orderId}`),{cache:`no-store`});
    const data=await res.json().catch(()=>({}));
    if(data.ok) setOrder(data.order);
  })()},[orderId]);
  const claim=async()=>{
    const res=await fetch(apiUrl(`/api/store/orders/${orderId}/claim`),{method:`POST`,headers:{'Content-Type':`application/json`},body:`{}`});
    const data=await res.json().catch(()=>({}));
    if(data.ok){setOrder((e)=>({...e,status:`claimed`}));setNote(`Payment claimed. The mentor will confirm it, then your license email is sent.`);}
  };
  if(!order) return jsx.jsx(`div`,{className:`le-store-wrap le-section`,children:`Loading checkout…`});
  const wa=website?.contacts?.whatsappLink||(website?.contacts?.whatsapp?`https://wa.me/${String(website.contacts.whatsapp).replace(/[^\d]/g,``)}`:``);
  return jsx.jsx(`div`,{className:`le-store-wrap le-section`,children:jsx.jsxs(`div`,{className:`le-glass`,style:{display:`grid`,gap:12,maxWidth:520,margin:`0 auto`},children:[
    jsx.jsx(`div`,{className:`le-store-kicker`,children:`Checkout`}),
    jsx.jsx(`h2`,{style:{margin:0},children:order.platform===`android`?`Android`:`iPhone`}),
    jsx.jsx(`p`,{children:esc(order.robotName)}),
    jsx.jsx(`strong`,{style:{fontSize:32},children:esc(order.amount)}),
    jsx.jsx(`div`,{children:esc(order.duration)}),
    jsx.jsx(`p`,{className:`muted`,children:`Pay the mentor the amount above. Lumo Edge only releases a license after the payment is confirmed on the server.`}),
    wa?jsx.jsx(`a`,{className:`le-btn le-btn-cyan`,href:wa,target:`_blank`,rel:`noreferrer`,children:`Pay on WhatsApp`}):null,
    website?.contacts?.email?jsx.jsx(`a`,{className:`le-btn le-btn-ghost`,href:`mailto:${website.contacts.email}`,children:`Email mentor`}):null,
    order.status===`paid`?jsx.jsx(`p`,{style:{color:`#4ade80`,fontWeight:700},children:`Payment confirmed. Check your email for the license key.`}):jsx.jsx(`button`,{type:`button`,className:`le-btn le-btn-ghost`,onClick:()=>void claim(),children:`I have paid`}),
    note?jsx.jsx(`p`,{children:note}):null,
    jsx.jsx(`a`,{href:`/store/${slug}`,children:`Back to website`})
  ]})});
}

function StorePage(){
  const [{slug,orderId},setParts]=(0,React.useState)(pathParts);
  const [website,setWebsite]=(0,React.useState)(null);
  const [error,setError]=(0,React.useState)(``);
  const [busy,setBusy]=(0,React.useState)(false);
  const [form,setForm]=(0,React.useState)({name:``,email:``,platform:``});
  (0,React.useEffect)(()=>{
    const onPop=()=>setParts(pathParts());
    window.addEventListener(`popstate`,onPop);
    return ()=>window.removeEventListener(`popstate`,onPop);
  },[]);
  (0,React.useEffect)(()=>{(async()=>{
    if(!slug){setError(`Website not found.`);return;}
    const res=await fetch(apiUrl(`/api/store/${encodeURIComponent(slug)}`),{cache:`no-store`});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.ok){setError(`This Lumo Edge website is not published.`);setWebsite(null);return;}
    setWebsite(data.website);setError(``);
  })()},[slug]);
  const startBuy=(platform)=>setForm((e)=>({...e,platform}));
  const submitBuy=async()=>{
    if(busy) return;
    setBusy(true);
    try{
      const res=await fetch(apiUrl(`/api/store/${encodeURIComponent(slug)}/checkout`),{method:`POST`,headers:{'Content-Type':`application/json`},body:JSON.stringify({platform:form.platform,name:form.name,email:form.email})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok) throw Error(data.error||`Checkout failed`);
      window.history.pushState({},``,data.order.checkoutPath);
      setParts(pathParts());
    }catch(e){setError(e instanceof Error?e.message:`Checkout failed`);}
    finally{setBusy(false)}
  };
  if(error&&!website) return jsx.jsx(StoreChrome,{children:jsx.jsx(`div`,{className:`le-store-wrap le-section`,children:error})});
  if(!website) return jsx.jsx(StoreChrome,{children:jsx.jsx(`div`,{className:`le-store-wrap le-section`,children:`Loading…`})});
  return jsx.jsxs(StoreChrome,{website,children:[
    orderId?jsx.jsx(Checkout,{slug,orderId,website}):jsx.jsx(WebsiteBody,{website,onBuy:startBuy}),
    form.platform&&!orderId?jsx.jsx(`div`,{className:`le-store-wrap`,children:jsx.jsxs(`div`,{className:`le-glass`,style:{display:`grid`,gap:10,marginBottom:28},children:[
      jsx.jsx(`strong`,{children:`Buy ${form.platform===`android`?`Android`:`iPhone`}`}),
      jsx.jsx(`input`,{value:form.name,onChange:e=>setForm(t=>({...t,name:e.target.value})),placeholder:`Your name`}),
      jsx.jsx(`input`,{value:form.email,onChange:e=>setForm(t=>({...t,email:e.target.value})),placeholder:`Your email`,autoComplete:`email`}),
      jsx.jsx(`button`,{type:`button`,className:`le-btn le-btn-cyan`,disabled:busy,onClick:()=>void submitBuy(),children:busy?`Starting…`:`Continue`}),
      error?jsx.jsx(`p`,{style:{color:`#f87171`},children:error}):null
    ]})}) : null
  ]});
}

export{StorePage};
