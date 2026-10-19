// Opt-in CPU-backed WebGL2 for headless CI hosts without a hardware GPU.
// The production runtime never imports this test-only module.
import { chromium } from "playwright";

if (process.env.NICECHUNK_TEST_SOFTWARE_GL === "1") {
  const launch=chromium.launch.bind(chromium);
  chromium.launch=(options={})=>launch({...options,args:[
    "--disable-gpu-sandbox","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader",
    ...options.args??[],
  ]});
}
