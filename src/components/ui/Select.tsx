type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={className} {...rest}>
      {children}
    </select>
  )
}
