import { defineConfig } from 'vite';
export default defineConfig({base:'./',envPrefix:'P2_PUBLIC_',server:{host:'127.0.0.1',port:9094,strictPort:true,cors:false},preview:{host:'127.0.0.1',port:9094,strictPort:true},build:{outDir:'dist',emptyOutDir:true,sourcemap:false}});
