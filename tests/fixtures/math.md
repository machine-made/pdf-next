# Math

Inline: $E = mc^2$, $\mathbf{u}\cdot\nabla\mathbf{u}$, $\vec{v}$, $\dot{x}$, $\mathbb{R}^n$, $x'$, $\frac{1}{\mathit{Re}}$.

Navier–Stokes in a numbered equation:

$$\begin{equation}
\partial_t \mathbf{u} + \mathbf{u}\cdot\nabla\mathbf{u} = -\nabla p + \frac{1}{\mathrm{Re}}\Delta\mathbf{u} \label{eq:ns}
\end{equation}$$

It is equation $\eqref{eq:ns}$, and the link goes back to it.

Aligned and split:

$$\begin{align} a &= b + c \\ c &= d \end{align}$$

$$\begin{split} a &= b \\ &= c \end{split}$$

```math
\left( \frac{a}{b} \right)^2 \quad \sqrt[3]{x} \quad \sum_{i=0}^{n} \int_a^b f(x)\,dx \quad \lim_{x\to 0}\frac{\sin x}{x}
```

Cases, a matrix and decorations:

$$\begin{cases} 1 & x>0 \\ 0 & \text{otherwise} \end{cases} \qquad
\begin{pmatrix} a & b \\ c & d \end{pmatrix} \qquad
\underbrace{a+b}_{c} \quad \xrightarrow{f} \quad \boxed{x} \quad \color{red}{x} \quad \mathscr{F} \mathfrak{g} \quad \boldsymbol{\omega}$$

A macro defined in one block and used in a later one:

$$\newcommand{\Rey}{\mathit{Re}} \Rey_\tau = \frac{u_\tau \delta}{\nu}$$

$$\frac{1}{\Rey} \quad \Rey^2$$

An unknown command keeps the rest of the equation: $\notacommand{x} + y$.

Fences stay code:

```
$$ not = math $$
```
