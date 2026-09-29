/* Built-app browser regression. Uses only in-memory API fixtures; never calls a real backend. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const {spawn} = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const artifacts = path.join(root, "traffic_dss_backend", ".test-tmp", "browser-artifacts");
fs.mkdirSync(artifacts, {recursive:true});
const server = http.createServer((req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,"http://local").pathname);
  let file = path.resolve(dist,"." + pathname);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(dist,"index.html");
  const types={".js":"application/javascript",".css":"text/css",".html":"text/html",".png":"image/png"};
  res.setHeader("Content-Type",types[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  console.log("Static test server ready");
  const origin="http://127.0.0.1:"+server.address().port;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"traffic-review-browser-"));
  const executable=process.env.BROWSER_EXE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser=spawn(executable,["--headless=new","--no-first-run","--no-default-browser-check","--remote-debugging-port=0",
    "--remote-allow-origins=*","--user-data-dir="+profile,"--window-size=1440,1000","--use-angle=swiftshader",
    "--enable-unsafe-swiftshader","about:blank"],{windowsHide:true,stdio:"ignore"});
  let ws;
  try {
    const portFile=path.join(profile,"DevToolsActivePort");
    for(let i=0;i<100 && !fs.existsSync(portFile);i++) await delay(100);
    assert(fs.existsSync(portFile),"Browser debugging port did not start");
    const port=fs.readFileSync(portFile,"utf8").split("\n")[0];
    const targets=await (await fetch("http://127.0.0.1:"+port+"/json")).json();
    console.log("Browser target ready");
    ws=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0; const pending=new Map(); const errors=[];
    function call(method,params={}) {
      return new Promise((resolve,reject)=>{
        const id=++sequence; const timeout=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout: "+method));},15000); pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}}); ws.send(JSON.stringify({id,method,params}));
      });
    }
    const empty={count:0,next:null,previous:null,results:[]};
    const kpis={coverage_efficiency:0,avg_response_time:null,resource_utilization:0,weather_impact_factor:null,
      shortages:2,required_staffing:2,assigned_staffing:0,as_of:new Date().toISOString()};
    const node={id:"B-TEST",name:'Test junction <img src=x onerror="window.exploited=true">',status:"normal",
      latitude:10.72,longitude:122.56,tsi:0.1,road_priority_weight:1,deployed_officers:0,required_officers:2};
    let publications=0;
    const previewRuns=[], exportedRuns=[];
    ws.onmessage=async message=>{
      const event=JSON.parse(message.data);
      if(event.id) {const job=pending.get(event.id);if(job){pending.delete(event.id);event.error?job.reject(event.error):job.resolve(event.result);}return;}
      if(event.method==="Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text + ": " + (event.params.exceptionDetails.exception?.description || ""));
      if(event.method!=="Fetch.requestPaused") return;
      const {requestId,request}=event.params;
      const url=new URL(request.url);
      if(request.url.startsWith(origin)) {await call("Fetch.continueRequest",{requestId});return;}
      if(request.method==="OPTIONS") {await call("Fetch.fulfillRequest",{requestId,responseCode:204,responseHeaders:[{name:"Access-Control-Allow-Origin",value:"*"},{name:"Access-Control-Allow-Headers",value:"*"},{name:"Access-Control-Allow-Methods",value:"GET,POST,PUT,DELETE,OPTIONS"}]});return;}
      let payload=empty;
      if(url.pathname.includes("/kpis/")) payload=kpis;
      else if(url.pathname.includes("/bottlenecks/")) payload={...empty,count:1,results:[node]};
      else if(url.pathname.includes("/weather/")) payload={condition:null,weather_impact_factor:null,source:"missing",available:false,data_status:"unavailable",is_stale:false};
      else if(url.pathname.includes("/optimization/status/")) payload={run_id:"early-fixture",status:"completed",current_generation:48,total_generations:300,current_fitness:95.75,converged_early:true,updated_at:new Date().toISOString(),estimated_completion:new Date().toISOString()};
      else if(url.pathname.includes("/optimization/results/")) payload={run_id:"early-fixture",status:"completed",fitness_scores:Array.from({length:48},(_,i)=>95.5+i/200),total_generations:300,converged_early:true,top_solutions:[{staffing_efficiency:100,reserve_officers:7,staffing_targets:{"B-TEST":2},staffing_shortages:{},resource_utilization:22.2,assignments:[{officer_id:1,badge_number:"DEMO-1",bottleneck_id:"B-TEST",bottleneck_name:"Quiet junction"},{officer_id:2,badge_number:"DEMO-2",bottleneck_id:"B-TEST",bottleneck_name:"Quiet junction"}]}],parameters:{}};
      else if(url.pathname.includes("/history/")) payload={...empty,count:3,results:[
        {id:1,run_id:"morning-fixture",timestamp:new Date().toISOString(),status:"completed",parameters:{shift:"morning"},fitness_scores:[],result_data:{}},
        {id:2,run_id:"generated-fixture",timestamp:new Date().toISOString(),status:"completed",parameters:{shift:"morning"},fitness_scores:[],result_data:{synthetic_data_used:["tsi"]}},
        {id:3,run_id:"shadow-fixture",timestamp:new Date().toISOString(),status:"completed",parameters:{shift:"morning",mode:"shadow"},fitness_scores:[],result_data:{}},
      ]};
      else if(url.pathname.includes("/preview-optimization/")) {
        previewRuns.push(JSON.parse(request.postData).run_id);
        const day=JSON.parse(request.postData).operational_date;
        payload={run_id:"morning-fixture",shift:"morning",created:2,replaced:1,skipped:[],staff_added:[2,3],staff_removed:[1],conflicts:[],operational_date:day,start_time:day+"T06:00:00+08:00",end_time:day+"T14:00:00+08:00",expected_revision:"browser-review",captured_at:new Date().toISOString(),input_issues:[],added_assignments:[],removed_assignments:[]};
        payload.added_assignments=[{officer_id:2,officer_name:"Officer Two",badge_number:"DEMO-2",bottleneck_id:"B-TEST",bottleneck_name:"Test junction"},{officer_id:3,officer_name:"Officer Three",badge_number:"DEMO-3",bottleneck_id:"B-TEST",bottleneck_name:"Test junction"}];
        payload.removed_assignments=[{officer_id:1,officer_name:"Officer One",badge_number:"DEMO-1",bottleneck_id:"B-TEST",bottleneck_name:"Test junction"}];
      }
      else if(url.pathname.includes("/publish-optimization/")) {
        const input=JSON.parse(request.postData);
        if(input.expected_revision!=="browser-review" || !input.idempotency_key) errors.push("Publication lacks its reviewed revision or request key");
        publications++;payload={created:2,shift:"morning",skipped:[]};
      }
      else if(url.pathname.includes("/optimization/export/")) {
        exportedRuns.push(decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1)));
        await call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"text/csv"},{name:"Access-Control-Allow-Origin",value:"*"}],body:Buffer.from("Run_ID,Location\nmorning-fixture,Test junction\n").toString("base64")});return;
      }
      else if(url.pathname.includes("/pois/") && request.method==="GET") payload={...empty,count:5,results:[
        ["hospital",10.720,122.560],["fire_station",10.716,122.567],["police_station",10.724,122.565],
        ["school",10.717,122.552],["other",10.726,122.556],
      ].map(([category,latitude,longitude],index)=>({id:index+1,poi_id:"POI-"+index,name:category+" fixture",
        category,latitude,longitude,priority_boost:1,is_active:true}))};
      else if(url.pathname.includes("/pois/") && request.method==="POST") {
        await call("Fetch.fulfillRequest",{requestId,responseCode:503,responseHeaders:[{name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:"*"}],body:Buffer.from(JSON.stringify({detail:"Test save failure"})).toString("base64")});return;
      }
      else if(url.pathname.includes("/configure/")) payload={valid:true,parameters:JSON.parse(request.postData),errors:{}};
      else if(!url.pathname.includes("/api/")) {await call("Fetch.failRequest",{requestId,errorReason:"BlockedByClient"});return;}
      const headers=[{name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:"*"},{name:"Access-Control-Allow-Headers",value:"*"}];
      await call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:headers,body:Buffer.from(JSON.stringify(payload)).toString("base64")});
    };
    await call("Page.enable");await call("Runtime.enable");await call("Network.enable");
    await call("Browser.setDownloadBehavior",{behavior:"deny"});
    await call("Network.setBlockedURLs",{urls:["ws://*","wss://*"]});
    await call("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
    await call("Emulation.setTimezoneOverride",{timezoneId:"America/Los_Angeles"});
    await call("Emulation.setFocusEmulationEnabled",{enabled:true});
    await call("Page.addScriptToEvaluateOnNewDocument",{source:'window.WebSocket = class { constructor(){setTimeout(()=>this.onclose?.(),10);} close(){} };'});
    const auth=role=>`localStorage.setItem("auth_token","test-only");localStorage.setItem("refresh_token","test-refresh");localStorage.setItem("auth_user",JSON.stringify({id:1,username:"Browser fixture",role:"${role}",permissions:[],shift:"morning"}));`;
    const authScript=await call("Page.addScriptToEvaluateOnNewDocument",{source:auth("supervisor")});
    const evaluate=async expression=>(await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
    const waitFor=async expression=>{
      for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}
      throw Error("Timed out: "+expression+"\n"+await evaluate("document.body.innerText"));
    };
    const clickText=text=>evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})?.click()`);
    console.log("Opening dashboard");
    await call("Page.navigate",{url:origin+"/"});
    await waitFor("document.body.innerText.includes('Unfilled posts: 2')");
    await waitFor('document.querySelector(\'button[aria-label^="Test junction"]\')');
    await evaluate('document.querySelector(\'button[aria-label^="Test junction"]\')?.click()');
    await waitFor("document.querySelector(\'.maplibregl-popup-content\')");
    assert.equal(await evaluate('!!document.querySelector(".maplibregl-popup-content img, .maplibregl-popup-content script")'),false);
    assert.equal(await evaluate("window.exploited"),undefined);
    assert.equal(await evaluate("[...document.querySelectorAll('a')].some(e=>/scenarios|analytics/i.test(e.getAttribute('href')))"),false);
    await waitFor("document.querySelectorAll('.poi-marker').length===5");
    assert.equal(await evaluate("new Set([...document.querySelectorAll('.poi-marker')].map(e=>e.dataset.poiCategory)).size"),5);
    await evaluate("document.querySelector('button[aria-label=\"Show School markers\"]').click()");
    await waitFor("document.querySelectorAll('.poi-marker').length===4");
    await evaluate("document.querySelector('button[aria-label=\"Show School markers\"]').click()");
    await waitFor("document.querySelectorAll('.poi-marker').length===5");
    await evaluate('document.querySelector(\'button[aria-label^="Test junction"]\')?.click()');
    await delay(250);
    const poiShot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"poi-markers.png"),Buffer.from(poiShot.data,"base64"));
    console.log("Opening publication board");
    await call("Page.navigate",{url:origin+"/gantt-chart"});
    await waitFor("[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Preview publication' && !e.disabled)");
    await clickText("Preview publication");
    await waitFor("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent.trim()==='Confirm publication' && !e.disabled)");
    assert.equal(await evaluate("document.querySelector('[role=dialog]').innerText.includes('Officer Two (DEMO-2)')"),true);
    assert.equal(publications,0);
    await delay(250);
    const shot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"publication-preview.png"),Buffer.from(shot.data,"base64"));
    await clickText("Confirm publication");
    await waitFor("document.body.innerText.includes('Published 2 assignments')");
    assert.equal(publications,1);
    console.log("Opening optimization history actions");
    await call("Page.navigate",{url:origin+"/optimization"});
    const actions='document.querySelector(\'[role="group"][aria-label="Actions for morning-fixture"]\')';
    await waitFor(`Boolean(${actions})`);
    for (const width of [1920,1280]) {
      await call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});
      await delay(100);
      const geometry=await evaluate(`(() => {
        const group=${actions}; const buttons=[...group.querySelectorAll('button')];
        const rects=buttons.map(button=>button.getBoundingClientRect());
        const groups=[...document.querySelectorAll('[role="group"][aria-label^="Actions for "]')];
        return {count:buttons.length,heights:rects.map(rect=>rect.height),tops:rects.map(rect=>rect.top),gap:rects[1].left-rects[0].right,
          rowHeights:groups.map(group=>group.closest('tr').getBoundingClientRect().height)};
      })()`);
      assert.equal(geometry.count,2);
      assert.equal(geometry.heights[0],geometry.heights[1],"History actions should be the same height");
      assert.equal(geometry.tops[0],geometry.tops[1],"History actions should share one row");
      assert(geometry.gap>=8,"History actions need visible spacing");
      assert.equal(geometry.rowHeights.length,3);
      assert(geometry.rowHeights.every(height=>Math.abs(height-geometry.rowHeights[0])<1),"Generated/shadow warnings must not increase row height");
      if(width===1920) {
        const actionsShot=await call("Page.captureScreenshot",{format:"png"});
        fs.writeFileSync(path.join(artifacts,"optimization-actions.png"),Buffer.from(actionsShot.data,"base64"));
      }
    }
    const blockedActions='document.querySelector(\'[role="group"][aria-label="Actions for generated-fixture"]\')';
    const previewCount=previewRuns.length;
    await evaluate(`${blockedActions}.querySelector('button[aria-label="Preview publication"]').click()`);
    assert.equal(previewRuns.length,previewCount,"Generated runs cannot open publication previews");
    await evaluate(`${blockedActions}.querySelector('span[tabindex="0"]').focus()`);
    await waitFor("document.querySelector('[role=tooltip]')?.textContent.includes('generated inputs (tsi)')");
    await evaluate(`${blockedActions}.querySelector('span[tabindex="0"]').blur()`);
    await waitFor("!document.querySelector('[role=tooltip]')");
    await evaluate(`${actions}.querySelector('button[aria-label="Preview publication"]').click()`);
    await waitFor("[...document.querySelectorAll('[role=dialog] button')].some(e=>e.textContent.trim()==='Confirm publication' && !e.disabled)");
    assert.equal(previewRuns.at(-1),"morning-fixture");
    await clickText("Cancel");
    await waitFor("!document.querySelector('[role=dialog]')");
    await evaluate(`${actions}.querySelector('button[aria-label="Export recommendation"]').click()`);
    await waitFor(`${actions}.querySelector('button[aria-label="Export recommendation"]')?.disabled === false`);
    assert.deepEqual(exportedRuns,["morning-fixture"]);
    assert.equal(publications,1,"Preview/export must not publish a run");
    await call("Emulation.clearDeviceMetricsOverride");
    console.log("Opening early-completed optimization run");
    await call("Page.navigate",{url:origin+"/optimization-running?run_id=early-fixture"});
    await waitFor("document.body.innerText.includes('100% Optimization Progress')");
    assert.equal(await evaluate("document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')"),"100");
    assert.equal(await evaluate("document.body.innerText.includes('Converged early after 48 generations (limit 300)')"),true);
    assert.equal(await evaluate("document.body.innerText.includes('16%')"),false);
    const completedShot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"optimization-early-completion.png"),Buffer.from(completedShot.data,"base64"));
    await call("Page.navigate",{url:origin+"/optimization-engine?run_id=early-fixture"});
    await waitFor("document.body.innerText.includes('Converged early after 48 generations (limit 300)')");
    assert.equal(await evaluate("document.body.innerText.includes('100%') && document.body.innerText.includes('48 (max 300)')"),true);
    assert.equal(await evaluate("document.body.innerText.includes('Staffing target: 2 officers') && document.body.innerText.includes('Officers in reserve: 7') && document.body.innerText.includes('Staffing Efficiency: 100.0%')"),true);
    await evaluate("[...document.querySelectorAll('p')].find(e=>e.textContent.includes('Staffing target: 2 officers')).scrollIntoView({block:'center'})");
    const staffingShot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"optimization-staffing-targets.png"),Buffer.from(staffingShot.data,"base64"));
    for(const oldRoute of ["/scenarios","/analytics"]){
      await call("Page.navigate",{url:origin+oldRoute});
      await waitFor("location.pathname === '/' && document.body.innerText.includes('Unfilled posts: 2')");
    }
    await evaluate(auth("dispatcher")+"window.dispatchEvent(new Event('auth-session-changed'));");
    await waitFor("![...document.querySelectorAll('a')].some(e=>e.getAttribute('href')==='/optimization')");
    await call("Page.removeScriptToEvaluateOnNewDocument",{identifier:authScript.identifier});
    await evaluate("localStorage.clear()");
    await call("Page.navigate",{url:origin+"/login"});
    await waitFor("document.body.innerText.includes(\'Sign In to System\')");
    assert.equal(errors.length,0,errors.join("\n"));
    console.log("Browser PASS: dashboard, malicious saved text, publication preview/confirmation, history action layout/preview/export at 1920 and 1280 widths, early completion, staffing targets/reserves, removed routes, dispatcher actions; timezone America/Los_Angeles.");
    console.log("Screenshots: "+path.join(artifacts,"poi-markers.png")+" and "+path.join(artifacts,"publication-preview.png"));
    await call("Browser.close").catch(()=>{});
  } finally {
    ws?.close(); browser.kill(); server.close();
    // Leave the isolated profile in the system temp directory; no user browser profile is touched.
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
