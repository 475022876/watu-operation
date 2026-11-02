import { defineConfig } from 'vite';
export default defineConfig({base:'/employee-pilot/',build:{outDir:'../../public/employee-pilot',emptyOutDir:true,rollupOptions:{input:'pilot.html'}}});
