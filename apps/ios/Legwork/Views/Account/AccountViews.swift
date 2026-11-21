import SwiftUI

/// The account entry point on Home (#63): "Sign in" when signed out, the
/// customer's initials and first name when signed in. Optional throughout:
/// nothing in the job flow waits for it.
struct AccountButton: View {
    @Environment(MockAuth.self) private var auth
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if let user = auth.currentUser {
                HStack(spacing: 6) {
                    Avatar(initials: user.initials, size: 26)
                    Text(user.firstName).lineLimit(1)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Account, \(user.name)")
                .accessibilityHint("Shows your jobs and signing out")
            } else {
                Label("Sign in", systemImage: "person.crop.circle")
                    .labelStyle(.titleAndIcon)
                    .accessibilityHint("Optional. You can post a job without an account")
            }
        }
    }
}

struct Avatar: View {
    let initials: String
    var size: CGFloat = 56

    var body: some View {
        Text(initials)
            .font(size > 40 ? .title3.weight(.semibold) : .caption.weight(.semibold))
            .foregroundStyle(.brand)
            .frame(width: size, height: size)
            .background(Color.brandSoft, in: .circle)
            .accessibilityHidden(true)
    }
}

/// The sheet behind the account button: sign in / sign up and the code while
/// signed out; the customer, "My jobs" and "Sign out" while signed in.
struct AccountSheet: View {
    @Environment(MockAuth.self) private var auth
    @Environment(\.dismiss) private var dismiss
    /// Opens a job on Home's stack once the sheet has closed.
    let openJob: (String) -> Void

    @State private var challenge: MockAuth.Challenge?

    var body: some View {
        NavigationStack {
            Group {
                if let user = auth.currentUser {
                    AccountView(user: user, openJob: openJob)
                } else if let challenge {
                    CodeView(challenge: challenge) { self.challenge = nil }
                } else {
                    SignInView { challenge = $0 }
                }
            }
            .animation(.default, value: auth.currentUser)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", systemImage: "xmark") { dismiss() }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct SignInView: View {
    @Environment(MockAuth.self) private var auth
    let onSent: (MockAuth.Challenge) -> Void

    private enum Mode: Hashable { case signIn, signUp }
    private enum Field: Hashable { case name, contact }

    @State private var mode: Mode = .signIn
    @State private var name = ""
    @State private var contact = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private var signUp: Bool { mode == .signUp }
    private var canSend: Bool {
        !busy && !contact.trimmingCharacters(in: .whitespaces).isEmpty && (!signUp || !name.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(signUp ? "Create your account" : "Sign in")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(signUp ? "Keep your jobs in one place." : "We'll send you a 6-digit code. No password needed.")
                        .foregroundStyle(.muted)
                }

                Picker("Account", selection: $mode) {
                    Text("Sign in").tag(Mode.signIn)
                    Text("Create account").tag(Mode.signUp)
                }
                .pickerStyle(.segmented)

                if signUp {
                    field("Your name") {
                        TextField("Name", text: $name)
                            .textContentType(.name)
                            .focused($focus, equals: .name)
                            .submitLabel(.next)
                            .onSubmit { focus = .contact }
                    }
                }
                field("Email or mobile") {
                    TextField("you@example.com or 0412 345 678", text: $contact)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .contact)
                        .submitLabel(.send)
                        .onSubmit { if canSend { Task { await send() } } }
                }

                if let error {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await send() }
                } label: {
                    HStack {
                        if busy { ProgressView() }
                        Text(busy ? "Sending code…" : "Send code")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(!canSend)

                Text("You can post a job without an account.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
            .padding(20)
        }
        .background(Color.canvas.ignoresSafeArea())
        .onAppear { focus = signUp ? .name : .contact }
        .onChange(of: mode) { error = nil }
    }

    private func field(_ label: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
            content()
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
                .accessibilityLabel(label)
        }
    }

    private func send() async {
        busy = true
        error = nil
        do {
            onSent(try await auth.signIn(contact: contact, name: signUp ? name : nil))
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}

private struct CodeView: View {
    @Environment(MockAuth.self) private var auth
    let challenge: MockAuth.Challenge
    let onBack: () -> Void

    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Enter your code")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text("We sent a 6-digit code to **\(challenge.contact.label)**.")
                        .foregroundStyle(.muted)
                }

                TextField("000000", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .font(.title.weight(.semibold).monospacedDigit())
                    .multilineTextAlignment(.center)
                    .focused($focused)
                    .padding(.vertical, 14)
                    .glassEffect(.regular, in: .rect(cornerRadius: 16))
                    .accessibilityLabel("6-digit code")
                    .accessibilityHint("Demo: any 6 digits work, for example \(MockAuth.codeHint)")
                    .onChange(of: code) { _, new in
                        let digits = String(new.filter(\.isNumber).prefix(6))
                        if digits != new { code = digits }
                    }

                // MOCK: no code is sent, so say which one to type.
                Text("Demo: any 6 digits work, e.g. **\(MockAuth.codeHint)**")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)

                if let error {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await verify() }
                } label: {
                    HStack {
                        if busy { ProgressView() }
                        Text(busy ? "Checking…" : challenge.isNew ? "Create account" : "Sign in")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(busy || code.count != 6)
            }
            .padding(20)
        }
        .background(Color.canvas.ignoresSafeArea())
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Back", systemImage: "chevron.backward", action: onBack)
            }
        }
        .onAppear { focused = true }
    }

    private func verify() async {
        busy = true
        error = nil
        do {
            try await auth.verifyCode(challenge, code: code)
        } catch {
            self.error = error.localizedDescription
        }
        busy = false
    }
}

private struct AccountView: View {
    @Environment(MockAuth.self) private var auth
    @Environment(JobStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let user: MockAuth.User
    let openJob: (String) -> Void

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    Avatar(initials: user.initials)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name).font(.title2.bold()).foregroundStyle(.ink)
                        Text(user.contact.label).font(.subheadline).foregroundStyle(.muted)
                    }
                }
                .accessibilityElement(children: .combine)
                .listRowBackground(Color.clear)
            }

            Section {
                if store.jobs.isEmpty {
                    Text("Jobs you post on this phone show up here.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.jobs) { entry in
                        Button {
                            dismiss()
                            openJob(entry.id)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(entry.description.isEmpty ? "Untitled job" : entry.description)
                                        .foregroundStyle(.ink)
                                        .lineLimit(2)
                                    Text(entry.createdAt, format: .relative(presentation: .named))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.forward")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                                    .accessibilityHidden(true)
                            }
                        }
                        .accessibilityHint("Opens the job")
                    }
                }
            } header: {
                Text("My jobs")
            } footer: {
                Text("Only jobs started on this phone for now.")
            }

            Section {
                Button("Sign out", role: .destructive) { auth.signOut() }
                    .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.canvas.ignoresSafeArea())
    }
}

#Preview("Signed out") {
    AccountSheet { _ in }
        .environment(MockAuth(defaults: UserDefaults(suiteName: "preview")!, delay: .zero))
        .environment(JobStore())
}
