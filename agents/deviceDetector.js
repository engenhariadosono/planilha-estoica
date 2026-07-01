// ============================================================
// DETECTOR DE CAPACIDADE DO DISPOSITIVO
// Decide se este navegador consegue rodar IA local (WebLLM).
// Não decide nada sobre API/offline — isso é responsabilidade
// do orchestrator, que tenta local → API → offline em cascata.
// ============================================================

function detectarNavegador() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  return 'Outro';
}

function estimarMemoria() {
  const ua = navigator.userAgent;
  const width = window.screen?.width || 0;
  const pixelRatio = window.devicePixelRatio || 1;

  if (width >= 2560 && pixelRatio >= 2) return 16;
  if (width >= 1920 && pixelRatio >= 2) return 8;
  if (width >= 1280) return 6;

  if (/iPhone/.test(ua)) return 3;
  if (/Android/.test(ua)) return /Pro|Ultra|Plus|Premium/.test(ua) ? 8 : 4;

  return 4;
}

// ===== VERIFICAR COMPATIBILIDADE COM WebLLM =====
export async function detectarSuporteLocal() {
  const resultado = {
    compativel: false,
    webgpu: false,
    memoriaGB: 0,
    navegador: detectarNavegador(),
    motivo: '',
  };

  if ('gpu' in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      resultado.webgpu = !!adapter;
    } catch (e) {
      resultado.webgpu = false;
    }
  }

  resultado.memoriaGB = ('deviceMemory' in navigator) ? (navigator.deviceMemory || 0) : estimarMemoria();

  // WebGPU disponível + RAM suficiente + navegador com bom suporte (Chrome/Edge)
  resultado.compativel =
    resultado.webgpu &&
    resultado.memoriaGB >= 4 &&
    (resultado.navegador === 'Chrome' || resultado.navegador === 'Edge');

  if (!resultado.webgpu) resultado.motivo = 'WebGPU não disponível neste navegador/dispositivo';
  else if (resultado.memoriaGB < 4) resultado.motivo = `Memória insuficiente (~${resultado.memoriaGB}GB, mínimo 4GB)`;
  else if (!resultado.compativel) resultado.motivo = `Navegador (${resultado.navegador}) sem suporte otimizado — use Chrome ou Edge`;
  else resultado.motivo = 'WebGPU disponível e memória suficiente';

  return resultado;
}
