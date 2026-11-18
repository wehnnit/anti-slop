export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  flavor: 'openai' | 'anthropic';
  note: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    flavor: 'openai',
    note: 'one key, many upstream models',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    flavor: 'openai',
    note: 'direct from the source',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    flavor: 'anthropic',
    note: 'Claude models over the messages API',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    flavor: 'openai',
    note: 'low-latency serving',
  },
  {
    id: 'together',
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    flavor: 'openai',
    note: 'open weights, hosted',
  },
  {
    id: 'ollama',
    label: 'Ollama local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    flavor: 'openai',
    note: 'stays on this machine, no key needed',
  },
];
