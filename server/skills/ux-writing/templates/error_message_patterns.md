# Error Message Patterns

## Error Message Framework

### Formula

**[What happened]** + **[Why (optional)]** + **[How to fix it]**

### Principles

1. **Don't blame the user** - Focus on the situation, not the person
2. **Be specific** - "Email is invalid" not "Error in field"
3. **Offer solutions** - Always show a path forward
4. **Use plain language** - No error codes without explanation
5. **Match the severity** - Don't panic the user

---

## Form Validation Errors

### Email Field

**Pattern**: [What's wrong] + [Expected format]

| Scenario | Error Message |
|----------|---------------|
| Empty | "Enter your email address" |
| Invalid format | "Enter a valid email address (e.g., name@example.com)" |
| Already registered | "This email is already registered. [Log in](#) or use a different email." |
| Not found | "We don't have an account with this email. [Create account](#)?" |

### Password Field

| Scenario | Error Message |
|----------|---------------|
| Empty | "Enter your password" |
| Too short | "Password must be at least 8 characters" |
| Missing requirements | "Password needs at least one number and one uppercase letter" |
| Doesn't match | "Passwords don't match" |
| Incorrect | "That password isn't right. Try again or [reset your password](#)." |

### Name Fields

| Scenario | Error Message |
|----------|---------------|
| Empty | "Enter your [first/last] name" |
| Invalid characters | "Name can only contain letters, spaces, and hyphens" |
| Too long | "Name must be under 50 characters" |

### Phone Number

| Scenario | Error Message |
|----------|---------------|
| Invalid format | "Enter a valid phone number (e.g., 555-123-4567)" |
| Missing country code | "Include your country code (e.g., +1 for US)" |

### Required Field (Generic)

| Scenario | Error Message |
|----------|---------------|
| Empty | "This field is required" or better: "[Field name] is required" |

---

## Authentication Errors

### Login

| Scenario | Message |
|----------|---------|
| Wrong credentials | "Email or password is incorrect. [Forgot password?](#)" |
| Account locked | "Account temporarily locked after too many attempts. Try again in 30 minutes." |
| Account suspended | "This account has been suspended. [Contact support](#) for help." |
| Unverified email | "Please verify your email first. [Resend verification email](#)" |

### Sign Up

| Scenario | Message |
|----------|---------|
| Email taken | "An account with this email already exists. [Log in](#) or use a different email." |
| Username taken | "This username is taken. Try another one." |
| Weak password | "Choose a stronger password. Mix letters, numbers, and symbols." |

### Password Reset

| Scenario | Message |
|----------|---------|
| Email not found | "We couldn't find an account with that email. Check the spelling or [create an account](#)." |
| Link expired | "This reset link has expired. [Request a new one](#)." |
| Already used | "This reset link has already been used. [Request a new one](#) if needed." |

---

## Payment Errors

### Card Errors

| Scenario | Message |
|----------|---------|
| Declined | "Your card was declined. Try a different card or contact your bank." |
| Expired | "This card has expired. Use a different card." |
| Invalid number | "Card number doesn't look right. Check and try again." |
| Invalid CVV | "CVV doesn't match. Check the 3-digit code on your card." |
| Insufficient funds | "Payment didn't go through. Try a different payment method." |

### Transaction Errors

| Scenario | Message |
|----------|---------|
| Processing failed | "We couldn't process your payment. Please try again." |
| Already charged | "You've already been charged for this. [View your orders](#)" |
| Currency mismatch | "We can't accept payments in this currency. Select [supported currencies]." |

---

## File and Upload Errors

### Upload Errors

| Scenario | Message |
|----------|---------|
| Too large | "File is too large. Maximum size is 10MB." |
| Wrong type | "This file type isn't supported. Use JPG, PNG, or PDF." |
| Upload failed | "Upload failed. Check your connection and try again." |
| Too many files | "You can only upload 5 files at once." |
| File corrupted | "This file appears to be corrupted. Try a different file." |

### Download Errors

| Scenario | Message |
|----------|---------|
| Not available | "This file is no longer available." |
| Processing | "File is being prepared. We'll notify you when it's ready." |

---

## Connection Errors

### Network Issues

| Scenario | Message |
|----------|---------|
| No connection | "You're offline. Check your internet connection." |
| Slow connection | "Connection is slow. This may take longer than usual." |
| Connection lost | "Connection lost. We'll save your progress and try again." |
| Server error | "Something went wrong on our end. Please try again in a few minutes." |

### Timeout

| Scenario | Message |
|----------|---------|
| Request timeout | "This is taking too long. Try again or [contact support](#)." |
| Session expired | "Your session expired. [Log in again](#) to continue." |

---

## Permission Errors

### Access Denied

| Scenario | Message |
|----------|---------|
| No permission | "You don't have access to this page. [Request access](#) from the owner." |
| Restricted action | "You don't have permission to do this. Contact your admin." |
| Feature locked | "This feature isn't available on your plan. [Upgrade](#) to access it." |

---

## Data Errors

### Not Found

| Scenario | Message |
|----------|---------|
| Page not found | "Page not found. It may have been moved or deleted. [Go home](#)" |
| Item not found | "This item doesn't exist or has been removed." |
| Search no results | "No results for '[query]'. Try different keywords." |

### Conflicts

| Scenario | Message |
|----------|---------|
| Already exists | "An item with this name already exists. Choose a different name." |
| Outdated version | "Someone else made changes. Refresh to see the latest version." |
| Locked item | "This item is being edited by someone else. Try again later." |

---

## Destructive Action Confirmations

### Delete

**Reversible**:
"Delete [item name]? You can restore it from trash for 30 days."
[Cancel] [Delete]

**Permanent**:
"Permanently delete [item name]? This can't be undone."
[Cancel] [Delete Forever]

### Account Actions

"Delete your account and all data? This action is permanent and cannot be undone."
[Cancel] [Delete My Account]

---

## Success Messages (For Comparison)

Pair errors with success messages:

| Action | Error | Success |
|--------|-------|---------|
| Save | "Couldn't save. Try again." | "Saved" |
| Send | "Message couldn't be sent." | "Message sent" |
| Delete | "Couldn't delete. Try again." | "[Item] deleted. [Undo](#)" |
| Upload | "Upload failed." | "File uploaded" |

---

## Error Message Tone Guide

### Serious Errors (Data loss, security)
- Clear and direct
- No humor
- Emphasize severity
- Provide support options

### Minor Errors (Validation, typos)
- Friendly and helpful
- Quick to fix
- Don't over-apologize

### System Errors (Outages, bugs)
- Honest about the problem
- Apologetic (it's our fault)
- Set expectations for resolution
- Provide alternatives

---

## Anti-Patterns (What NOT to Write)

| Bad | Why | Better |
|-----|-----|--------|
| "Error" | Too vague | "[Specific error]" |
| "Invalid input" | What input? What's invalid? | "Enter a valid email" |
| "An error occurred" | What happened? | "Payment failed. Try a different card." |
| "Error 404" | Users don't speak HTTP | "Page not found" |
| "You entered wrong data" | Blaming | "Check the highlighted fields" |
| "Oops!" | Dismissive | Appropriate acknowledgment |
| "Fatal error" | Alarming | "Something went wrong" |
