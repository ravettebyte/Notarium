import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'browser.spec.mts',workers:1,use:{baseURL:'http://localhost:8889',headless:true},reporter:'list'});
