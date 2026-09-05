import * as RadixAlertDialog from "@radix-ui/react-alert-dialog"
import Button from "@razzia/web/components/Button"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  trigger: ReactNode
  title: string
  description: string
  confirmLabel?: string
  /**
   * Le rouge annonce une perte. Il est donc le défaut — la quasi-totalité des
   * confirmations d'ici portent sur une suppression — mais une confirmation
   * qui ne détruit rien ne doit pas l'emprunter : à force de teindre en rouge
   * ce qui ne l'est pas, plus rien ne se lit comme un avertissement.
   */
  variante?: "danger" | "neutre"
  onConfirm: () => void
}

const AlertDialog = ({
  trigger,
  title,
  description,
  confirmLabel,
  variante = "danger",
  onConfirm,
}: Props) => {
  const { t } = useTranslation()

  return (
    <RadixAlertDialog.Root>
      <RadixAlertDialog.Trigger asChild>{trigger}</RadixAlertDialog.Trigger>

      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className="data-[state=open]:animate-fade-in fixed inset-0 z-50 bg-black/40" />

        <RadixAlertDialog.Content
          onClick={(e) => e.stopPropagation()}
          className="bg-background fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-xl"
        >
          <RadixAlertDialog.Title className="text-foreground text-lg font-semibold">
            {title}
          </RadixAlertDialog.Title>

          <RadixAlertDialog.Description className="text-muted-foreground mt-2">
            {description}
          </RadixAlertDialog.Description>

          <div className="mt-6 flex justify-end gap-2">
            <RadixAlertDialog.Cancel asChild>
              <Button className="bg-accent text-accent-foreground px-4 py-2 text-sm font-semibold">
                {t("common:cancel")}
              </Button>
            </RadixAlertDialog.Cancel>

            <RadixAlertDialog.Action asChild>
              <Button
                className={`px-4 py-2 text-sm font-semibold hover:brightness-95 active:brightness-90 ${
                  variante === "danger" ? "bg-red-500 text-white" : "bg-primary"
                }`}
                onClick={onConfirm}
              >
                {confirmLabel ?? t("common:confirm")}
              </Button>
            </RadixAlertDialog.Action>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  )
}

export default AlertDialog
