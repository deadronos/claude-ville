import * as React from 'react';
import { clsx } from 'clsx';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonCva = cva('inline-flex items-center justify-center font-pixel transition-colors', {
  variants: {
    variant: {
      default: 'bg-surface text-text border border-border hover:bg-surfaceAlt',
      accent: 'bg-accent text-background hover:bg-accent/80',
      ghost: 'bg-transparent text-text hover:bg-surface',
      danger: 'bg-danger text-background hover:bg-danger/80',
    },
    size: {
      sm: 'h-8 px-2 text-xs',
      md: 'h-10 px-4 text-sm',
      lg: 'h-12 px-6 text-base',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonCva> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(buttonCva({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
