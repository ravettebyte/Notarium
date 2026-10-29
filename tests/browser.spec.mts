import { test, expect } from '@playwright/test';
const model={schemaVersion:1,revision:0,profile:{displayName:'Professor Teste',username:'professor',role:'teacher',defaultOctave:4},blocks:[],exerciseBlocks:[],lessons:[],exercises:[],attempts:[],trails:[],trailSettings:[]};
for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 test(`interface and musical audio at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const original=AudioContext.prototype.createOscillator;(window as any).playedNotes=0;AudioContext.prototype.createOscillator=function(){(window as any).playedNotes++;return original.call(this);};});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   const data=path==='/api/session'?{authenticated:true,user:{id:'teacher',name:'Professor Teste',username:'professor',role:'teacher',isAdmin:true},model}:path==='/api/students'?{students:[]}:path==='/api/notifications'?{notifications:[]}:path==='/api/composition'?{composition:{title:'Escala',notes:'C4 D4 E4',tempo:120}}:path==='/api/backups'?{runs:[]}:{ok:true};
   await route.fulfill({json:data});
  });
  await page.goto('/');await expect(page.locator('#app-content')).toBeVisible();
  await page.getByRole('button',{name:'Abrir configurações'}).click();
  await page.locator('[data-action="open-composition"]').click();
  await expect(page.locator('#composition-preview svg')).toBeVisible();
  await page.locator('#composition-play').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).playedNotes)).toBeGreaterThan(0);
  await page.locator('#composition-form button[type=submit], #composition-form button:not([type])').last().click();
  await expect(page.locator('#composition-status')).toHaveText('Partitura salva na sua conta.');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="backup-monitor"]').click();
  await expect(page.getByText('Nenhuma execução registrada.',{exact:false})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-view="aulas"]').first().click({force:true});await expect(page.locator('#app-content')).toBeVisible();
  expect(errors).toEqual([]);
 });
}
test('welcome form validates email and confirmation fields',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/setup'?{teacherExists:false}:{authenticated:false}}));
 await page.goto('/');await expect(page.locator('#account-access-form')).toBeVisible();
 await expect(page.locator('[name=email]').first()).toHaveAttribute('type','email');await expect(page.locator('[name=confirmPassword]')).toHaveAttribute('minlength','12');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
