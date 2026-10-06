/* Built-app browser regression. API writes are always fixtures.
 * LIVE_TRAFFIC_TILES=1 enables read-only traffic tiles from the running backend. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const {spawn} = require("node:child_process");
// An opaque grid and valid traffic road exercise tile decoding without external requests.
const baseTile = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4nGP4TwAwgIhHLz7gxMNDAQDLt/Iu3TsrkAAAAABJRU5ErkJggg==";
const trafficTile = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAANUlEQVR4nO3OMQ0AMAgAQVQgqjYRCumABpb75PeLrNf/uGoBEBAQEBAQEBAQEBAQEBAQV4gBpQG8vQOicB0AAAAASUVORK5CYII=";
const liveTrafficTiles = process.env.LIVE_TRAFFIC_TILES === "1";
let probeLiveTrafficTiles = liveTrafficTiles;
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
  const browser=spawn(executable,["--headless=new","--no-first-run","--no-default-browser-check","--disable-extensions","--remote-debugging-port=0",
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
        const id=++sequence; const timeout=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout: "+method));},15000); pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{
          clearTimeout(timeout);
          // Navigation/source recovery may abort a paused image request before
          // its asynchronous interception handler resumes.
          if(method.startsWith("Fetch.") && error.code===-32602 && /Invalid InterceptionId/i.test(error.message)) resolve({});
          else reject(error);
        }}); ws.send(JSON.stringify({id,method,params}));
      });
    }
    const empty={count:0,next:null,previous:null,results:[]};
    const kpis={coverage_efficiency:0,avg_response_time:null,resource_utilization:0,weather_impact_factor:null,
      shortages:2,required_staffing:2,assigned_staffing:0,as_of:new Date().toISOString()};
    const node={id:"B-TEST",name:'Test junction <img src=x onerror="window.exploited=true">',status:"normal",
      latitude:10.72,longitude:122.56,tsi:0.1,road_priority_weight:1,deployed_officers:0,required_officers:2};
    let publications=0;
    const loadedTiles={base:0,traffic:0};
    const trafficZooms=new Set();
    let trafficUnavailable=false;
    const previewRuns=[], exportedRuns=[];
    let timedFixtures=false;
    let staffingProfile={area_name:"Prime State",signal_status:"none",min_officers_required:0,max_officers_allowed:4,
      staffing_periods:[{start:"06:30",end:"07:30",required:1,label:"Morning post"},{start:"09:00",end:"10:00",required:1,label:"School traffic"}]};
    const savedAssignments=[], savedProfiles=[];
    const reservedBlocks=[];
    let editedEnd="07:30";
    ws.onmessage=async message=>{
      const event=JSON.parse(message.data);
      if(event.id) {const job=pending.get(event.id);if(job){pending.delete(event.id);event.error?job.reject(event.error):job.resolve(event.result);}return;}
      if(event.method==="Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text + ": " + (event.params.exceptionDetails.exception?.description || ""));
      if(event.method==="Network.responseReceived") {
        const response=event.params.response;
        const tile=new URL(response.url).pathname.match(/\/api\/maps\/tomtom-traffic\/(\d+)\/\d+\/\d+\.png$/);
        if(tile && response.status===200 && response.mimeType==="image/png") trafficZooms.add(Number(tile[1]));
      }
      if(event.method!=="Fetch.requestPaused") return;
      const {requestId,request}=event.params;
      const url=new URL(request.url);
      if(request.url.startsWith(origin)) {await call("Fetch.continueRequest",{requestId});return;}
      if(request.method==="OPTIONS") {await call("Fetch.fulfillRequest",{requestId,responseCode:204,responseHeaders:[{name:"Access-Control-Allow-Origin",value:"*"},{name:"Access-Control-Allow-Headers",value:"*"},{name:"Access-Control-Allow-Methods",value:"GET,POST,PUT,DELETE,OPTIONS"}]});return;}
      const isBaseTile=url.hostname==="a.tile.openstreetmap.org" && url.pathname.endsWith(".png");
      const isTrafficTile=url.pathname.includes("/api/maps/tomtom-traffic/") && url.pathname.endsWith(".png");
      if(isBaseTile || isTrafficTile) {
        if(isTrafficTile && trafficUnavailable) {
          await call("Fetch.fulfillRequest",{requestId,responseCode:503,responseHeaders:[
            {name:"Content-Type",value:"application/json"},{name:"Access-Control-Allow-Origin",value:"*"},
          ],body:Buffer.from(JSON.stringify({detail:"Traffic route unavailable"})).toString("base64")});
          return;
        }
        if(probeLiveTrafficTiles && isTrafficTile) {
          assert.equal(request.method,"GET");
          if(isTrafficTile) assert.equal(url.hostname,"127.0.0.1");
          await call("Fetch.continueRequest",{requestId});
          loadedTiles[isBaseTile?"base":"traffic"]++;
          return;
        }
        await call("Fetch.fulfillRequest",{requestId,responseCode:200,responseHeaders:[
          {name:"Content-Type",value:"image/png"},
          {name:"Access-Control-Allow-Origin",value:"*"},
        ],body:isBaseTile?baseTile:trafficTile});
        loadedTiles[isBaseTile?"base":"traffic"]++;
        return;
      }
      let payload=empty;
      if(url.pathname.includes("/deployments/review/")) payload={needs_review:timedFixtures,scope:"Remaining schedule",issues:timedFixtures?[{bottleneck:"B-TEST",reason:"Staffing profile changed since publication.",assignment_ids:[700]}]:[]};
      else if(url.pathname.includes("/deployments/time-blocks/")) {
        if(request.method==="POST") reservedBlocks.push({...JSON.parse(request.postData),id:900,officer_name:"Officer Alpha",badge_number:"ALPHA"});
        payload=request.method==="POST"?reservedBlocks.at(-1):reservedBlocks;
      }
      else if(url.pathname.includes("/deployments/observations/")) payload=[];
      else if(timedFixtures && url.pathname.includes("/bottlenecks/manage/") && request.method==="PUT") {
        staffingProfile={...staffingProfile,...JSON.parse(request.postData)};savedProfiles.push(staffingProfile);payload={...node,...staffingProfile};
      }
      else if(timedFixtures && url.pathname.includes("/bottlenecks/")) {
        const day=url.searchParams.get("date") || "2099-01-01";
        const times=url.searchParams.get("shift")==="afternoon" ? [["14:00","22:00",0,"Quiet"]] : [
          ["06:00","06:30",0,"Quiet"],["06:30","07:30",staffingProfile.staffing_periods[0].required,"Morning post"],
          ["07:30","09:00",0,"Quiet"],["09:00","10:00",1,"School traffic"],["10:00","14:00",0,"Quiet"]];
        payload={...empty,count:1,results:[{...node,...staffingProfile,name:"Intersection A",staffing_windows:times.map(([start,end,required,reason])=>({start_time:day+"T"+start+":00+08:00",end_time:day+"T"+end+":00+08:00",required,reason}))}]};
      }
      else if(timedFixtures && url.pathname.includes("/officers/")) payload={...empty,count:1,results:[{id:1,name:"Officer Alpha",badge_number:"ALPHA",shift:"morning",status:"available",skills:[]}]};
      else if(timedFixtures && url.pathname.includes("/deployments/schedule/")) {
        const day=url.searchParams.get("date") || "2099-01-01";
        payload={...empty,count:2,results:[[700,"06:30",editedEnd],[701,"09:00","10:00"]].map(([id,start,end])=>({id,officer_id:1,officer:"ALPHA",officer_name:"Officer Alpha",bottleneck:"B-TEST",bottleneck_name:"Intersection A",area_name:"Prime State",shift:"morning",assignment_type:"static",status:"assigned",start_time:day+"T"+start+":00+08:00",end_time:day+"T"+end+":00+08:00"}))};
      }
      else if(timedFixtures && url.pathname.includes("/deployments/700/update/")) {const data=JSON.parse(request.postData);savedAssignments.push(data);editedEnd=data.end_time.slice(11,16);payload=data;}
      else if(url.pathname.includes("/kpis/")) payload=kpis;
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
    // Retain pixels only in the test browser so we can assert actual WebGL road rendering.
    await call("Page.addScriptToEvaluateOnNewDocument",{source:`
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(type,options) {
        return getContext.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);
      };
    `});
    const auth=role=>`localStorage.setItem("auth_token","test-only");localStorage.setItem("refresh_token","test-refresh");localStorage.setItem("auth_user",JSON.stringify({id:1,username:"Browser fixture",role:"${role}",permissions:[],shift:"morning"}));`;
    const authScript=await call("Page.addScriptToEvaluateOnNewDocument",{source:auth("supervisor")});
    const evaluate=async expression=>(await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true})).result?.value;
    const waitFor=async (expression, timeoutMs=10000)=>{
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline){if(await evaluate(expression))return;await delay(100);}
      throw Error("Timed out: "+expression+"\n"+await evaluate("document.body.innerText"));
    };
    const clickText=text=>evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})?.click()`);
    console.log("Opening dashboard");
    await call("Page.navigate",{url:origin+"/"});
    await waitFor("document.body.innerText.includes('Shift-average unfilled posts: 2')");
    await waitFor('document.querySelector(\'button[aria-label^="Test junction"]\')');
    const hasTrafficPixels=`(() => {
      const canvas=document.querySelector('.maplibregl-canvas');
      const gl=canvas?.getContext('webgl2');if(!gl)return false;
      const pixels=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let green=0;
      for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>80&&pixels[i+1]>pixels[i]*1.5&&pixels[i+1]>pixels[i+2]*1.3&&pixels[i+3]>0)green++;
      return green>100;
    })()`;
    await waitFor(hasTrafficPixels, liveTrafficTiles?60000:10000);
    assert(loadedTiles.base>0,"Map must load base tiles");
    assert(loadedTiles.traffic>0,"Map must load traffic tiles and render their roads");
    await waitFor("!document.querySelector('[aria-label=\"Retry traffic layer\"]')", liveTrafficTiles?60000:10000);
    if(liveTrafficTiles) {
      await evaluate("document.querySelector('[aria-label=\"Center map\"]').click()");
      for(const zoom of [13,14,15]) {
        if(zoom>13) await evaluate("document.querySelector('[aria-label=\"Zoom in\"]').click()");
        await delay(800);
        // MapLibre's 512px world uses one higher tile zoom for 256px raster tiles.
        const tileZoom=zoom+1;
        for(let i=0;i<600 && !trafficZooms.has(tileZoom);i++) await delay(100);
        assert(trafficZooms.has(tileZoom),`Running backend must return PNG traffic at map zoom ${zoom} (tile zoom ${tileZoom})`);
        await waitFor(hasTrafficPixels, 60000);
      }
      console.log("Live backend traffic rendered at zooms 13, 14, and 15");
      const liveShot=await call("Page.captureScreenshot",{format:"png"});
      fs.writeFileSync(path.join(artifacts,"traffic-live.png"),Buffer.from(liveShot.data,"base64"));
      // The following injected-outage and application regressions use fixtures.
      // Live connectivity is verified above; deterministic recovery is separate.
      probeLiveTrafficTiles=false;
      await evaluate("document.querySelector('[aria-label=\"Center map\"]').click()");
      await delay(800);
    }
    await evaluate('document.querySelector(\'button[aria-label^="Test junction"]\')?.click()');
    await waitFor("document.querySelector(\'.maplibregl-popup-content\')");
    await waitFor("document.body.innerText.includes('Bottleneck Details')");
    assert.equal(await evaluate("(() => {const panel=document.querySelector('[aria-label=\"Dashboard details and quick actions\"]');panel.scrollTop=panel.scrollHeight;const run=[...panel.querySelectorAll('a')].find(e=>e.textContent.includes('Run Optimization'));const p=panel.getBoundingClientRect(),r=run.getBoundingClientRect();return panel.scrollTop>0&&r.top>=p.top&&r.bottom<=p.bottom+1;})()"),true,"Quick Optimize must remain reachable when bottleneck details are open");
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
    trafficUnavailable=true;
    await call("Network.setCacheDisabled",{cacheDisabled:true});
    await call("Page.navigate",{url:origin+"/"});
    await waitFor("document.body.innerText.includes('Traffic layer unavailable') && document.querySelector('.maplibregl-marker')");
    trafficUnavailable=false;
    await evaluate("document.querySelector('[aria-label=\"Retry traffic layer\"]').click()");
    await waitFor("!document.querySelector('[aria-label=\"Retry traffic layer\"]')");
    await waitFor(hasTrafficPixels);
    console.log("Traffic tiles recovered without leaving the dashboard");
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
    console.log("Opening dynamic deployment Gantt");
    timedFixtures=true;
    await call("Page.navigate",{url:origin+"/gantt-chart"});
    await waitFor("Boolean(document.querySelector('input[type=date]') && document.querySelector('[data-assignment-id=\"700\"]'))");
    await evaluate("(() => {const input=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2099-01-01');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor("document.body.innerText.includes('2099-01-01') && !document.querySelector('[data-assignment-id=\"700\"]').disabled");
    assert.equal(await evaluate("document.querySelector('[data-assignment-id=\"700\"]').style.left"),"3.125%");
    assert.equal(await evaluate("document.querySelector('[data-assignment-id=\"700\"]').style.width"),"6.25%");
    await clickText("By Intersection");
    await waitFor("document.body.innerText.includes('0 required')");
    await evaluate("document.querySelector('[aria-label=\"Deployment Gantt timeline\"]').scrollIntoView({block:'start'})");
    const ganttShot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"dynamic-deployment-gantt.png"),Buffer.from(ganttShot.data,"base64"));
    await clickText("Staffing periods");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('Staffing by time period')");
    await evaluate("(() => {const input=document.querySelector('[aria-label=\"Period 1 officers\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await delay(250);
    const profileShot=await call("Page.captureScreenshot",{format:"png"});
    fs.writeFileSync(path.join(artifacts,"staffing-period-editor.png"),Buffer.from(profileShot.data,"base64"));
    await clickText("Save staffing");
    await waitFor("!document.querySelector('[role=dialog]')");
    assert.equal(savedProfiles.length,1);assert.equal(savedProfiles[0].staffing_periods[0].required,0);
    await evaluate("document.querySelector('[data-assignment-id=\"700\"]').click()");
    await waitFor("document.querySelector('[role=dialog]')?.innerText.includes('Edit assignment')");
    await evaluate("(() => {const input=[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.includes('End time')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'08:00');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await clickText("Save assignment");
    await waitFor("!document.querySelector('[role=dialog]') && document.querySelector('[data-assignment-id=\"700\"]').style.width === '9.375%'");
    assert.equal(savedAssignments.length,1);assert.equal(savedAssignments[0].end_time,"2099-01-01T08:00:00+08:00");
    await waitFor("document.body.innerText.includes('Schedule needs review')");
    await evaluate("document.querySelector('[aria-label=\"Area filter\"]').value='Prime State'; document.querySelector('[aria-label=\"Area filter\"]').dispatchEvent(new Event('change',{bubbles:true}));");
    await evaluate("[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('Breaks and travel')).click()");
    await evaluate("(() => {const form=document.querySelector('select[name=kind]').form;form.elements.officer.value='1';form.elements.start.value='08:00';form.elements.end.value='08:30';form.requestSubmit();})()");
    await waitFor("document.body.innerText.includes('ALPHA · break')");
    assert.equal(reservedBlocks.length,1);assert.equal(reservedBlocks[0].start_time,'2099-01-01T08:00:00+08:00');
    await clickText("By Officer");
    await waitFor("[...document.querySelectorAll('[aria-label=\"Deployment Gantt timeline\"] div')].some(e=>e.textContent==='Break')");
    await evaluate("document.querySelector('[aria-label=\"Schedule review and field feedback\"]').scrollIntoView({block:'start'})");
    const operationsShot=await call("Page.captureScreenshot",{format:"png"});fs.writeFileSync(path.join(artifacts,"deployment-operations.png"),Buffer.from(operationsShot.data,"base64"));
    assert.equal(publications,1,"Editing staffing and assignments must not publish a recommendation");
    timedFixtures=false;
    for(const oldRoute of ["/scenarios","/analytics"]){
      await call("Page.navigate",{url:origin+oldRoute});
      await waitFor("location.pathname === '/' && document.body.innerText.includes('Shift-average unfilled posts: 2')");
    }
    await evaluate(auth("dispatcher")+"window.dispatchEvent(new Event('auth-session-changed'));");
    await waitFor("![...document.querySelectorAll('a')].some(e=>e.getAttribute('href')==='/optimization')");
    await call("Page.removeScriptToEvaluateOnNewDocument",{identifier:authScript.identifier});
    await evaluate("localStorage.clear()");
    await call("Page.navigate",{url:origin+"/login"});
    await waitFor("document.body.innerText.includes(\'Sign In to System\')");
    assert.equal(errors.length,0,errors.join("\n"));
    console.log("Browser PASS: base tiles and WebGL traffic road pixels, dashboard, publication preview/confirmation, history action layout, early completion, staffing targets/reserves, Gantt geometry, zero staffing profiles, timed edits, area filter, schedule review, break reservations, removed routes, dispatcher actions; timezone America/Los_Angeles.");
    console.log("Screenshots: "+path.join(artifacts,"poi-markers.png")+" and "+path.join(artifacts,"publication-preview.png"));
    await call("Browser.close").catch(()=>{});
  } finally {
    ws?.close(); browser.kill(); server.close();
    // Leave the isolated profile in the system temp directory; no user browser profile is touched.
  }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
