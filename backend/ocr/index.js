import { LocalOCRProvider } from './local_ocr_provider.js';
import { CloudOCRProvider } from './cloud_ocr_provider.js';
import { MockOCRProvider } from './mock_ocr_provider.js';

let activeProvider = new LocalOCRProvider();

export function getOCRProvider() {
  return activeProvider;
}

export function setOCRProvider(provider) {
  activeProvider = provider;
}

export { LocalOCRProvider, CloudOCRProvider, MockOCRProvider };
