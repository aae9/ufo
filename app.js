import * as d3 from 'https://esm.sh/d3@7';

const data = await d3.csv('nuforc_str.csv');
console.log(data);