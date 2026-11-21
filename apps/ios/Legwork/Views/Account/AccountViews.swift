import SwiftUI

/// The account entry point on Home (#63): a dark glass circle over the photo.
/// A person icon when signed out, the customer's initials when signed in.
/// Optional throughout: nothing in the job flow waits for it.
struct AccountButton: View {
    @Environment(MockAuth.self) private var auth
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let user = auth.currentUser {
                    Text(user.initials).font(.system(size: 15, weight: .semibold))
                } else {
                    LWIcon("user", size: LW.Size.iconBar)
                }
            }
            .frame(width: LW.Size.iconButton, height: LW.Size.iconButton)
            .lwGlassOnPhoto()
            .contentShape(Circle())
        }
        .buttonStyle(.lwPlain)
        .frame(minWidth: LW.Size.tapMin, minHeight: LW.Size.tapMin)
        .accessibilityLabel(auth.currentUser.map { "Account, \($0.name)" } ?? "Sign in")
        .accessibilityHint(auth.currentUser == nil
                           ? "Optional. You can post a job without an account"
                           : "Shows your jobs and signing out")
    }
}

/// Initials in a circle: `glass-inner` with an ink letterform.
struct Avatar: View {
    let initials: String
    var size: CGFloat = LW.Size.avatar

    var body: some View {
        LWInitials(text: initials, size: size)
    }
}

/// The glass sheet behind the account button: sign in / sign up and the code
/// while signed out; the customer, their jobs and "Sign out" while signed in.
struct AccountSheet: View {
    @Environment(MockAuth.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Opens a job on Home's stack once the sheet has closed.
    let openJob: (String) -> Void

    @State private var challenge: MockAuth.Challenge?

    var body: some View {
        VStack(spacing: 0) {
            header
            Group {
                if let user = auth.currentUser {
                    AccountView(user: user, openJob: openJob)
                } else if let challenge {
                    CodeView(challenge: challenge)
                } else {
                    SignInView { challenge = $0 }
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .foregroundStyle(LW.Color.text)
        .tint(LW.Color.text)
        .animation(reduceMotion ? nil : LW.Motion.ease, value: auth.currentUser)
        .animation(reduceMotion ? nil : LW.Motion.ease, value: challenge?.contact.label)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .lwSheetBackground()
    }

    /// Back (on the code step) · title · close.
    private var header: some View {
        HStack {
            if auth.currentUser == nil, challenge != nil {
                LWIconButton(icon: "arrow-left", label: "Back") { challenge = nil }
            } else {
                Color.clear.frame(width: LW.Size.iconButton, height: LW.Size.iconButton)
            }
            Spacer()
            Text("Account").lwText(.headline).accessibilityAddTraits(.isHeader)
            Spacer()
            LWIconButton(icon: "x", label: "Close") { dismiss() }
        }
        .padding(.horizontal, LW.Space.md)
        .padding(.top, LW.Space.md)
    }
}

// MARK: - Sign in

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
            VStack(alignment: .leading, spacing: LW.Space.md) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(signUp ? "Create your account" : "Sign in")
                        .lwText(.title1)
                        .accessibilityAddTraits(.isHeader)
                    Text(signUp ? "Keep your jobs in one place." : "We'll send you a 6-digit code. No password needed.")
                        .lwText(.body)
                        .foregroundStyle(LW.Color.text2)
                }

                HStack(spacing: LW.Space.xs) {
                    LWChip("Sign in", isSelected: !signUp) { mode = .signIn }
                    LWChip("Create account", isSelected: signUp) { mode = .signUp }
                }

                if signUp {
                    field("Your name") {
                        TextField("Name", text: $name)
                            .textContentType(.name)
                            .focused($focus, equals: .name)
                            .submitLabel(.next)
                            .onSubmit { focus = .contact }
                    }
                }
                field("Email or mobile", error: error != nil) {
                    TextField("you@example.com or 0412 345 678", text: $contact)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .contact)
                        .submitLabel(.send)
                        .onSubmit { if canSend { Task { await send() } } }
                }

                if let error { LWErrorNote(error) }

                Button(busy ? "Sending code…" : "Send code") {
                    Task { await send() }
                }
                .buttonStyle(.lwPrimary)
                .disabled(!canSend)
                .padding(.top, LW.Space.xs)

                Text("You can post a job without an account.")
                    .lwText(.footnote)
                    .foregroundStyle(LW.Color.text3)
                    .frame(maxWidth: .infinity)

                APIStatusLine()
                    .padding(.top, LW.Space.lg)
            }
            .padding(.horizontal, LW.Layout.screenMargin)
            .padding(.vertical, LW.Space.md)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { focus = signUp ? .name : .contact }
        .onChange(of: mode) { error = nil }
    }

    private func field(_ label: String, error: Bool = false, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).lwText(.label).foregroundStyle(LW.Color.text2)
            content()
                .lwField(error: error)
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

// MARK: - Code

private struct CodeView: View {
    @Environment(MockAuth.self) private var auth
    let challenge: MockAuth.Challenge

    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LW.Space.md) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Enter your code")
                        .lwText(.title1)
                        .accessibilityAddTraits(.isHeader)
                    Text("We sent a 6-digit code to **\(challenge.contact.label)**.")
                        .lwText(.body)
                        .foregroundStyle(LW.Color.text2)
                }

                TextField("000000", text: $code)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .lwText(.pin)
                    .multilineTextAlignment(.center)
                    .focused($focused)
                    .padding(.vertical, LW.Layout.innerPadding)
                    .frame(maxWidth: .infinity)
                    .lwInner(radius: LW.Radius.md)
                    .lwRing(error != nil, radius: LW.Radius.md)
                    .accessibilityLabel("6-digit code")
                    .accessibilityHint("Demo: any 6 digits work, for example \(MockAuth.codeHint)")
                    .onChange(of: code) { _, new in
                        let digits = String(new.filter(\.isNumber).prefix(6))
                        if digits != new { code = digits }
                    }

                if let error { LWErrorNote(error) }

                // MOCK: no code is sent, so say which one to type.
                Text("Demo: any 6 digits work, e.g. **\(MockAuth.codeHint)**")
                    .lwText(.subhead)
                    .foregroundStyle(LW.Color.text3)
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)

                Button(busy ? "Checking…" : challenge.isNew ? "Create account" : "Sign in") {
                    Task { await verify() }
                }
                .buttonStyle(.lwPrimary)
                .disabled(busy || code.count != 6)
                .padding(.top, LW.Space.xs)
            }
            .padding(.horizontal, LW.Layout.screenMargin)
            .padding(.vertical, LW.Space.md)
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

// MARK: - Signed in

private struct AccountView: View {
    @Environment(MockAuth.self) private var auth
    @Environment(JobStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let user: MockAuth.User
    let openJob: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: LW.Space.lg) {
                HStack(spacing: 14) {
                    Avatar(initials: user.initials)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.name).lwText(.title2)
                        Text(user.contact.label).lwText(.callout).foregroundStyle(LW.Color.text2)
                    }
                }
                .accessibilityElement(children: .combine)
                .padding(.horizontal, LW.Space.xs)

                let saved = store.jobs.filter { $0.kind == .saved }
                if !saved.isEmpty {
                    section(JobsView.savedTitle, note: JobsView.savedNote, jobs: saved, hint: "Opens the job to search again")
                }

                let others = store.jobs.filter { $0.kind != .saved }
                if store.jobs.isEmpty {
                    VStack(alignment: .leading, spacing: LW.Space.xs) {
                        LWSectionLabel("MY JOBS")
                        Text("Jobs you post on this phone show up here.")
                            .lwText(.callout)
                            .foregroundStyle(LW.Color.text2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(LW.Layout.innerPadding)
                            .lwInner()
                    }
                } else if !others.isEmpty {
                    section("My jobs", note: "Only jobs started on this phone for now.", jobs: others, hint: "Opens the job")
                }

                Button("Sign out") { auth.signOut() }
                    .buttonStyle(.lwSecondary)

                APIStatusLine()
            }
            .padding(.horizontal, LW.Space.md)
            .padding(.vertical, LW.Space.md)
        }
    }

    private func section(_ title: String, note: String, jobs: [JobStore.Entry], hint: String) -> some View {
        VStack(alignment: .leading, spacing: LW.Space.xs) {
            LWSectionLabel(title.uppercased()).padding(.leading, 6)
            VStack(spacing: 0) {
                ForEach(Array(jobs.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { LWDivider() }
                    Button {
                        dismiss()
                        openJob(entry.id)
                    } label: {
                        JobEntryRow(entry: entry)
                    }
                    .buttonStyle(.lwPlain)
                    .accessibilityHint(hint)
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, LW.Space.md)
            .lwInner()
            Text(note).lwText(.caption).foregroundStyle(LW.Color.text2).padding(.horizontal, 6)
        }
    }
}

// MARK: - API status

/// A quiet debug line: whether the API answers `GET /health`. Tap to check again.
private struct APIStatusLine: View {
    @Environment(\.api) private var api

    enum Status: Equatable {
        case checking
        case ok(environment: String)
        case down(String)
    }

    @State private var status: Status = .checking

    var body: some View {
        Button {
            Task { await check() }
        } label: {
            HStack(spacing: 6) {
                LWIcon(icon, size: 14)
                Text(title + " · " + (AppConfig.apiBaseURL.host() ?? AppConfig.apiBaseURL.absoluteString))
                    .lwText(.footnote)
                    .lineLimit(1)
            }
            .foregroundStyle(LW.Color.text3)
            .frame(maxWidth: .infinity, minHeight: LW.Size.tapMin)
            .contentShape(Rectangle())
        }
        .buttonStyle(.lwPlain)
        .accessibilityHint("Checks the connection again")
        .task { await check() }
    }

    private var icon: String {
        switch status {
        case .checking: "clock"
        case .ok: "check"
        case .down: "warning-circle"
        }
    }

    private var title: String {
        switch status {
        case .checking: "Checking the API…"
        case .ok(let environment): "API online, \(environment)"
        case .down(let message): message
        }
    }

    private func check() async {
        status = .checking
        do {
            let health = try await api.health()
            status = health.ok ? .ok(environment: health.environment) : .down("API reported a problem")
        } catch is CancellationError {
        } catch {
            status = .down("API unreachable")
        }
    }
}

#Preview("Signed out") {
    AccountSheet { _ in }
        .environment(MockAuth(defaults: UserDefaults(suiteName: "preview")!, delay: .zero))
        .environment(JobStore())
}
