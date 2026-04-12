import { mount } from 'svelte';
import App from './App.svelte';
import './studio.css';
import './system/global.css';

const app = mount(App, {
  target: document.getElementById('app'),
  props: {
    page: document.body.dataset.page || 'overview',
  },
});

export default app;
