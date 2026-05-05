import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Plus, Package, Repeat, Power, PowerOff, ArrowLeft, Pencil } from 'lucide-react'
import { Card, CardContent } from '@shared/ui/Card'
import { Button } from '@shared/ui/Button'
import { Badge } from '@shared/ui/Badge'
import { Skeleton } from '@shared/ui/Skeleton'
import { useAuthStore } from '@shared/stores/auth-store'
import {
  useProducts,
  useUpdateProduct,
  useDeactivatePrice,
  type BillingProductDto,
  type BillingPriceDto,
  type BillingMode,
} from '@features/billing/hooks/useProducts'
import { ProductFormDialog } from '@features/billing/components/ProductFormDialog'
import { PriceFormDialog } from '@features/billing/components/PriceFormDialog'
import { EditProductDialog } from '@features/billing/components/EditProductDialog'

const ProductsPage = React.memo(function ProductsPage() {
  const account = useAuthStore((s) => s.account)
  const { data, isLoading } = useProducts()
  const updateProduct = useUpdateProduct()

  const [productDialogOpen, setProductDialogOpen] = React.useState(false)
  const [editingProduct, setEditingProduct] = React.useState<BillingProductDto | null>(null)
  const [priceDialogState, setPriceDialogState] = React.useState<{
    open: boolean
    productId: string | null
    productMode: BillingMode | null
    productName: string | null
  }>({ open: false, productId: null, productMode: null, productName: null })

  if (account?.role !== 'ADMIN') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-neutral-600">
          Ten widok jest dostępny tylko dla kont administratora.
        </CardContent>
      </Card>
    )
  }

  const handleToggleActive = async (product: BillingProductDto) => {
    try {
      await updateProduct.mutateAsync({ id: product.id, isActive: !product.isActive })
      toast.success(product.isActive ? 'Produkt deaktywowany.' : 'Produkt aktywowany.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się zmienić statusu.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/admin/billing"
            className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
          >
            <ArrowLeft className="h-3 w-3" />
            Stripe — konfiguracja
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900">Produkty + ceny</h1>
          <p className="text-sm text-neutral-500">
            Tworzenie produktów i cen synchronizuje się z Twoim kontem Stripe (test mode).
          </p>
        </div>
        <Button onClick={() => setProductDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Nowy produkt
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-6 w-1/2" />
          </CardContent>
        </Card>
      ) : !data?.products.length ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Package className="h-10 w-10 text-neutral-400" />
            <h3 className="text-lg font-medium text-neutral-900">Brak produktów</h3>
            <p className="max-w-md text-sm text-neutral-500">
              Stwórz pierwszy produkt — np. paczkę &quot;1M tokenów za $50&quot; lub miesięczną
              subskrypcję &quot;Pro&quot;. Każdy produkt może mieć wiele cen.
            </p>
            <Button onClick={() => setProductDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Stwórz pierwszy produkt
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.products.map((product) => (
            <ProductRow
              key={product.id}
              product={product}
              onAddPrice={() =>
                setPriceDialogState({
                  open: true,
                  productId: product.id,
                  productMode: product.mode,
                  productName: product.name,
                })
              }
              onToggleActive={() => handleToggleActive(product)}
              onEdit={() => setEditingProduct(product)}
            />
          ))}
        </div>
      )}

      <ProductFormDialog open={productDialogOpen} onOpenChange={setProductDialogOpen} />
      <EditProductDialog
        open={editingProduct !== null}
        onOpenChange={(open) => !open && setEditingProduct(null)}
        product={editingProduct}
      />
      <PriceFormDialog
        open={priceDialogState.open}
        onOpenChange={(open) =>
          setPriceDialogState((s) => ({ ...s, open }))
        }
        productId={priceDialogState.productId}
        productMode={priceDialogState.productMode}
        productName={priceDialogState.productName}
      />
    </div>
  )
})
ProductsPage.displayName = 'ProductsPage'

const ProductRow = React.memo(function ProductRow({
  product,
  onAddPrice,
  onToggleActive,
  onEdit,
}: {
  product: BillingProductDto
  onAddPrice: () => void
  onToggleActive: () => void
  onEdit: () => void
}) {
  return (
    <Card className={!product.isActive ? 'opacity-60' : ''}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-neutral-900">{product.name}</h3>
              <Badge variant={product.mode === 'SUBSCRIPTION' ? 'secondary' : 'default'}>
                {product.mode === 'SUBSCRIPTION' ? (
                  <>
                    <Repeat className="mr-1 h-3 w-3" /> Subskrypcja
                  </>
                ) : (
                  <>
                    <Package className="mr-1 h-3 w-3" /> Pakiet
                  </>
                )}
              </Badge>
              {!product.isActive && <Badge variant="warning">nieaktywny</Badge>}
            </div>
            {product.description && (
              <p className="mt-1 text-sm text-neutral-500">{product.description}</p>
            )}
            <p className="mt-1 font-mono text-xs text-neutral-400">
              {product.stripeProductId}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1 h-3 w-3" />
              Edytuj
            </Button>
            <Button size="sm" variant="outline" onClick={onToggleActive}>
              {product.isActive ? (
                <>
                  <PowerOff className="mr-1 h-3 w-3" /> Deaktywuj
                </>
              ) : (
                <>
                  <Power className="mr-1 h-3 w-3" /> Aktywuj
                </>
              )}
            </Button>
            <Button size="sm" onClick={onAddPrice}>
              <Plus className="mr-1 h-3 w-3" />
              Nowa cena
            </Button>
          </div>
        </div>

        {product.prices.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed border-neutral-300 p-4 text-center text-sm text-neutral-500">
            Brak cen — kliknij &quot;Nowa cena&quot; żeby dodać.
          </div>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {product.prices.map((price) => (
              <PriceCard key={price.id} price={price} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
})

const PriceCard = React.memo(function PriceCard({ price }: { price: BillingPriceDto }) {
  const deactivate = useDeactivatePrice()
  const usd = (price.unitAmount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  })
  const tokens = formatTokens(price.tokensGranted)
  const cadence = price.interval ? `/${price.interval === 'month' ? 'mc' : 'rok'}` : ' jednorazowo'

  const handleDeactivate = async () => {
    if (!confirm('Deaktywować tę cenę? Klienci nie będą mogli jej wybrać. Stripe pozostawi historię.')) return
    try {
      await deactivate.mutateAsync(price.id)
      toast.success('Cena deaktywowana.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Nie udało się deaktywować.')
    }
  }

  return (
    <div
      className={`rounded-md border p-3 ${price.isActive ? 'border-neutral-200 bg-white' : 'border-neutral-200 bg-neutral-50 opacity-60'}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-base font-semibold tabular-nums text-neutral-900">
            {usd}
            <span className="text-sm font-normal text-neutral-500">{cadence}</span>
          </p>
          <p className="text-xs text-neutral-500">
            {tokens} tokenów{price.interval ? ` na ${price.interval === 'month' ? 'mc' : 'rok'}` : ''}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-400">{price.stripePriceId}</p>
        </div>
        {price.isActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDeactivate}
            disabled={deactivate.isPending}
            className="text-red-600 hover:bg-red-50"
          >
            Deaktywuj
          </Button>
        )}
        {!price.isActive && <Badge variant="warning">nieaktywna</Badge>}
      </div>
    </div>
  )
})

function formatTokens(value: string): string {
  try {
    const n = BigInt(value)
    if (n >= 1_000_000n) return `${(Number(n) / 1_000_000).toFixed(1).replace('.0', '')}M`
    if (n >= 1_000n) return `${(Number(n) / 1_000).toFixed(1).replace('.0', '')}k`
    return n.toString()
  } catch {
    return value
  }
}

export const Route = createFileRoute('/admin/billing/products')({
  component: ProductsPage,
})
