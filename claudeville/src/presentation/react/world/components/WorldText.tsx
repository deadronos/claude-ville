import { Children } from 'react';
import type { ComponentProps, ReactNode } from 'react';

import { Text as DreiText } from '@react-three/drei';

const DEFAULT_WORLD_TEXT_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
  ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~…' +
  '⚡📋💬🎭👥🔍📁📝✏️🌐📓📐❓zZ';

function collectTextCharacters(children: ReactNode) {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }
      return '';
    })
    .join('');
}

export function WorldText(props: ComponentProps<typeof DreiText>) {
  const characters = props.characters ?? `${DEFAULT_WORLD_TEXT_CHARACTERS}${collectTextCharacters(props.children)}`;

  return (
    <DreiText
      {...props}
      characters={characters}
      renderOrder={props.renderOrder ?? 1000}
      scale={[1, -1, 1]}
    />
  );
}
