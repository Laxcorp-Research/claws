// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { CredentialsModal } from "@/components/setup/credentials-modal"
import type { ToolCredentialField } from "@/data/tool-catalog"

const singleField: ToolCredentialField[] = [
  { envVar: "TAVILY_API_KEY", label: "API Key", required: true, primary: true },
]

const coinbaseFields: ToolCredentialField[] = [
  { envVar: "COINBASE_API_KEY", label: "API Key", required: true, primary: true },
  { envVar: "COINBASE_API_SECRET", label: "API Secret", required: true, primary: false },
  { envVar: "COINBASE_API_PASSPHRASE", label: "API Passphrase", required: true, primary: false },
]

afterEach(() => {
  cleanup()
})

describe("CredentialsModal", () => {
  it("renders one input for a single-credential tool", () => {
    render(
      <CredentialsModal
        open={true}
        onClose={() => {}}
        toolName="Tavily"
        credentialFields={singleField}
        onSave={async () => ({ success: true })}
      />,
    )
    // One input
    const inputs = screen.getAllByRole("textbox")
    expect(inputs).toHaveLength(1)
    expect(screen.getByText("API Key")).toBeDefined()
  })

  it("renders three inputs for coinbase (multi-cred with passphrase)", () => {
    render(
      <CredentialsModal
        open={true}
        onClose={() => {}}
        toolName="Coinbase Exchange"
        credentialFields={coinbaseFields}
        onSave={async () => ({ success: true })}
      />,
    )
    const inputs = screen.getAllByRole("textbox")
    expect(inputs).toHaveLength(3)
    expect(screen.getByText("API Key")).toBeDefined()
    expect(screen.getByText("API Secret")).toBeDefined()
    expect(screen.getByText("API Passphrase")).toBeDefined()
  })

  it("disables the Validate button until all required fields are filled", () => {
    render(
      <CredentialsModal
        open={true}
        onClose={() => {}}
        toolName="Binance"
        credentialFields={[
          { envVar: "BINANCE_API_KEY", label: "API Key", required: true, primary: true },
          { envVar: "BINANCE_API_SECRET", label: "API Secret", required: true, primary: false },
        ]}
        onSave={async () => ({ success: true })}
      />,
    )
    const button = screen.getByRole("button", { name: /Validate all & save/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    const inputs = screen.getAllByRole("textbox")
    fireEvent.change(inputs[0], { target: { value: "key-value" } })
    expect((button as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(inputs[1], { target: { value: "secret-value" } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it("calls onSave with the full credentials record when submitted", async () => {
    const onSave = vi.fn(async () => ({ success: true }))
    render(
      <CredentialsModal
        open={true}
        onClose={() => {}}
        toolName="Binance"
        credentialFields={[
          { envVar: "BINANCE_API_KEY", label: "API Key", required: true, primary: true },
          { envVar: "BINANCE_API_SECRET", label: "API Secret", required: true, primary: false },
        ]}
        onSave={onSave}
      />,
    )
    const inputs = screen.getAllByRole("textbox")
    fireEvent.change(inputs[0], { target: { value: "binance-key" } })
    fireEvent.change(inputs[1], { target: { value: "binance-secret" } })
    fireEvent.click(screen.getByRole("button", { name: /Validate all & save/i }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1)
    })
    expect(onSave).toHaveBeenCalledWith({
      BINANCE_API_KEY: "binance-key",
      BINANCE_API_SECRET: "binance-secret",
    })
  })

  it("prefills known fields from prefilledCredentials on mount", () => {
    render(
      <CredentialsModal
        open={true}
        onClose={() => {}}
        toolName="Binance"
        credentialFields={[
          { envVar: "BINANCE_API_KEY", label: "API Key", required: true, primary: true },
          { envVar: "BINANCE_API_SECRET", label: "API Secret", required: true, primary: false },
        ]}
        prefilledCredentials={{ BINANCE_API_KEY: "carried-over-key" }}
        onSave={async () => ({ success: true })}
      />,
    )
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[]
    // API Key field is prefilled from NEEDS_CREDENTIALS carry-over
    expect(inputs[0].value).toBe("carried-over-key")
    // API Secret field is blank — user needs to provide it
    expect(inputs[1].value).toBe("")
    // Validate button stays disabled until the secret field is filled too
    const button = screen.getByRole("button", { name: /Validate all & save/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows an error row when onSave returns { success: false, error }", async () => {
    const onSave = vi.fn(async () => ({ success: false, error: "Invalid API key" }))
    render(
      <CredentialsModal
        open={true}
        onClose={() => {}}
        toolName="Tavily"
        credentialFields={singleField}
        onSave={onSave}
      />,
    )
    const inputs = screen.getAllByRole("textbox")
    fireEvent.change(inputs[0], { target: { value: "bad-key" } })
    fireEvent.click(screen.getByRole("button", { name: /Validate & save/i }))

    await waitFor(() => {
      expect(screen.getByText(/Invalid API key/)).toBeDefined()
    })
    expect(screen.getByText(/Validation failed/)).toBeDefined()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
