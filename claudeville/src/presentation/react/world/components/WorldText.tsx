import type { ComponentProps } from 'react';

import { Text as DreiText } from '@react-three/drei';

export function WorldText(props: ComponentProps<typeof DreiText>) {
  return <DreiText {...props} scale={[1, -1, 1]} />;
}
