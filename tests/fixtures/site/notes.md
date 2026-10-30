# Wake notes

The cylinder wake turns unsteady at $\mathrm{Re}_c \approx 46.7$. Below it the
recirculation bubble is steady and symmetric; above it a single global mode
grows and saturates into the von Kármán street.

## Linear stability

Linearise about the base flow $\mathbf{U}$ and look for modes
$\mathbf{u}' = \hat{\mathbf{u}}\,e^{\lambda t}$:

$$\lambda\,\hat{\mathbf{u}} = -(\mathbf{U}\cdot\nabla)\hat{\mathbf{u}} - (\hat{\mathbf{u}}\cdot\nabla)\mathbf{U} - \nabla\hat p + \frac{1}{\mathrm{Re}}\,\Delta\hat{\mathbf{u}}$$

The growth rate $\sigma = \Re(\lambda)$ crosses zero at onset, and the
frequency $\omega = \Im(\lambda)$ gives $\mathrm{St} = 0.118$.

## Next

- Check the Strouhal number against the DNS at $\mathrm{Re} = 60$.
- Add the adjoint mode and the wavemaker.
- Rewrite the abstract once the sensitivity map is in.

```python
sigma, omega = eigs(jacobian(U, Re), k=1, sigma=0.1j)
print(f"St = {omega / (2 * pi):.3f}")
```
