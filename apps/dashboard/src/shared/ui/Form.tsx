import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { Slot } from '@radix-ui/react-slot'
import {
  Controller,
  useForm,
  useFormContext,
  FormProvider,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  type UseFormProps,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { cn } from '@shared/utils/cn'

/**
 * Form primitives — RHF + Zod + accessible by default. shadcn-inspired API.
 *
 * Recommended usage with the `useZodForm` helper:
 *
 *   const schema = z.object({ email: emailSchema })
 *   type FormValues = z.infer<typeof schema>
 *
 *   const form = useZodForm(schema)
 *
 *   return (
 *     <Form {...form}>
 *       <form onSubmit={form.handleSubmit(onSubmit)}>
 *         <FormField
 *           control={form.control}
 *           name="email"
 *           render={({ field }) => (
 *             <FormItem>
 *               <FormLabel>Email</FormLabel>
 *               <FormControl><Input type="email" {...field} /></FormControl>
 *               <FormMessage />
 *             </FormItem>
 *           )}
 *         />
 *         <Button type="submit">Wyślij</Button>
 *       </form>
 *     </Form>
 *   )
 */

// =============================================================================
// Form (just an alias for FormProvider so the JSX reads cleanly)
// =============================================================================

const Form = FormProvider

// =============================================================================
// useZodForm — sugar over useForm + zodResolver
//
// Type plumbing note: @hookform/resolvers@5 ships dual zod v3/v4 generics.
// We use a structural shape (`_input` / `_output`) rather than importing
// `ZodType` directly because zod 3.25 with TS strict mode produces an
// incompatible variance on `ZodType<any, any, any>` vs the resolver's
// internal `Zod3Type`. The cast on `zodResolver(schema as any)` is type-only
// — runtime is unaffected. Revisit if we upgrade to zod v4.
// =============================================================================

interface ZodLikeSchema<TInput extends FieldValues = FieldValues, TOutput = TInput> {
  _input: TInput
  _output: TOutput
}

export function useZodForm<TSchema extends ZodLikeSchema>(
  schema: TSchema,
  options?: Omit<UseFormProps<TSchema['_input']>, 'resolver'>,
) {
  return useForm<TSchema['_input']>({
    ...options,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any),
  })
}

// =============================================================================
// FormField — wires RHF Controller + per-field context (id, error, etc.)
// =============================================================================

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue | null>(null)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

// =============================================================================
// FormItem — one row (label + control + description + error). Provides an id.
// =============================================================================

interface FormItemContextValue {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue | null>(null)

const FormItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const id = React.useId()
    return (
      <FormItemContext.Provider value={{ id }}>
        <div ref={ref} className={cn('space-y-2', className)} {...props} />
      </FormItemContext.Provider>
    )
  },
)
FormItem.displayName = 'FormItem'

// =============================================================================
// useFormField — internal hook gluing Controller + Item + RHF state
// =============================================================================

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext) throw new Error('useFormField must be used within <FormField>')
  if (!itemContext) throw new Error('useFormField must be used within <FormItem>')

  const fieldState = getFieldState(fieldContext.name, formState)

  return {
    id: itemContext.id,
    name: fieldContext.name,
    formItemId: `${itemContext.id}-form-item`,
    formDescriptionId: `${itemContext.id}-description`,
    formMessageId: `${itemContext.id}-message`,
    ...fieldState,
  }
}

// =============================================================================
// FormLabel — accessible label tied to the form item id
// =============================================================================

const FormLabel = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()
  return (
    <LabelPrimitive.Root
      ref={ref}
      htmlFor={formItemId}
      className={cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        error && 'text-red-600',
        className,
      )}
      {...props}
    />
  )
})
FormLabel.displayName = 'FormLabel'

// =============================================================================
// FormControl — Slot that wires aria-describedby and aria-invalid
// =============================================================================

const FormControl = React.forwardRef<
  React.ElementRef<typeof Slot>,
  React.ComponentPropsWithoutRef<typeof Slot>
>(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={
        error
          ? `${formDescriptionId} ${formMessageId}`
          : formDescriptionId
      }
      aria-invalid={!!error}
      {...props}
    />
  )
})
FormControl.displayName = 'FormControl'

// =============================================================================
// FormDescription — gray helper text below the input
// =============================================================================

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-sm text-neutral-500', className)}
      {...props}
    />
  )
})
FormDescription.displayName = 'FormDescription'

// =============================================================================
// FormMessage — renders the Zod error message; null when valid
// =============================================================================

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error.message) : children
  if (!body) return null
  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn('text-sm font-medium text-red-600', className)}
      {...props}
    >
      {body}
    </p>
  )
})
FormMessage.displayName = 'FormMessage'

export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  useFormField,
}
