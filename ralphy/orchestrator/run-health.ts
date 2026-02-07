import { GimliWrapper } from './src/gimli-wrapper';

const wrapper = new GimliWrapper({
  gimliPath: '/home/gimli/github/gimli',
  orchestratorPath: '/home/gimli/github/gimli/ralphy/orchestrator',
});

async function main() {
  console.log('🔍 Running health check...\n');
  
  try {
    const health = await wrapper.checkHealth();
    console.log('Health:', JSON.stringify(health, null, 2));
  } catch (err) {
    console.log('Health check error:', err);
  }
  
  console.log('\n🔄 Checking upstream...\n');
  
  try {
    const upstream = await wrapper.checkUpstream();
    console.log('Upstream:', JSON.stringify(upstream, null, 2));
  } catch (err) {
    console.log('Upstream check error:', err);
  }
  
  console.log('\n📊 Metrics:\n');
  console.log(JSON.stringify(wrapper.getMetrics(), null, 2));
}

main().catch(console.error);
